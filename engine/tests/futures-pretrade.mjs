import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { LINEAR_PNL, createContractStore, registerContract } from "../services/contract-specs.mjs";
import { createFuturesPaperStore } from "../services/futures-paper.mjs";
import { FUTURES_RISK_ACTION } from "../services/futures-risk.mjs";
import {
  FUTURES_PRETRADE_LIMITATIONS,
  FUTURES_PRETRADE_REASON_CODES,
  checkFuturesPreTrade,
  createFuturesPreTradeStore,
  readFuturesPreTrade,
} from "../services/futures-pretrade.mjs";
import * as pretrade from "../services/futures-pretrade.mjs";

// Cap numbers, lag 1000, and funding interval 8 are fixtures and are NOT IN SOURCE.
const TIME = 1499865549590;
const LAG = 1000;
const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };

function contract() {
  return {
    id: "fixture-linear-perpetual",
    canonicalSymbol: "fixture-canonical",
    venueSymbol: "fixture-venue",
    base: "BTC",
    quote: "USDT",
    style: "linear",
    tenor: "perpetual",
    multiplier: "1",
    settlementCurrency: "USDT",
    tickSize: "0.5",
    lotSize: "1",
    markSource: "fixture-mark",
    indexSource: "fixture-index",
    expiry: null,
    fundingInterval: "8",
  };
}

function feed(overrides = {}) {
  return {
    value: "100",
    eventTime: TIME,
    sequence: "2",
    sequenceWatermark: "1",
    quality: { healthy: true, reason: null },
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    asOf: TIME,
    receiveTime: TIME + LAG,
    lagThreshold: LAG,
    mark: feed(),
    index: feed({ sequence: "4", sequenceWatermark: "3" }),
    funding: feed({ value: "0.0001", sequence: "9", sequenceWatermark: "8" }),
    openInterest: feed({
      value: "12",
      sequence: "6",
      sequenceWatermark: "5",
      discontinuity: false,
    }),
    liquidationFeed: {
      status: "available",
      eventTime: TIME,
      quality: { healthy: true, reason: null },
      events: [],
    },
    prediction: { product: "futures", score: "14" },
    spot: { product: "spot", bid: "0.0025", ask: "0.0026", score: "22" },
    ...overrides,
  };
}

function risk(overrides = {}) {
  return {
    leverage: "2",
    maxLeverage: "2",
    marginMode: "isolated",
    notional: "10",
    maxNotional: "10",
    maintenanceMarginBuffer: "0.050",
    maintenanceMarginBufferFloor: "0.05",
    liquidationDistance: "0.2",
    liquidationDistanceFloor: "0.2",
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    contractId: "fixture-linear-perpetual",
    direction: "long",
    quantity: "2",
    price: "100",
    reduceOnly: false,
    positionMode: "one-way",
    marginMode: "isolated",
    product: "futures",
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    actor: ACTOR,
    decisionId: "fixture-decision",
    idempotencyKey: "fixture-key",
    orderId: "fixture-futures-order",
    killSwitch: false,
    stopPolicy: { configured: true },
    risk: risk(),
    feed: observation(),
    order: order(),
    ...overrides,
  };
}

function stores() {
  const book = createContractStore();
  assert.equal(registerContract(book, contract()).ok, true);
  return {
    contracts: book,
    futures: createFuturesPaperStore(),
    pretrade: createFuturesPreTradeStore(),
  };
}

function paper(result) {
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.deepEqual(result.limitations, FUTURES_PRETRADE_LIMITATIONS);
}

test("boundary caps veto and an equal cap can simulate", () => {
  const held = stores();
  const opened = checkFuturesPreTrade(held, request());
  paper(opened);
  assert.equal(opened.ok, true);
  assert.equal(opened.blocked, null);
  assert.equal(opened.reasonCode, null);
  assert.equal(opened.action, null);
  assert.equal(opened.orderCreated, true);
  assert.equal(opened.product, "futures");
  assert.equal(opened.pnl, null);
  assert.equal(opened.position.long.quantity, "2");
  assert.equal(opened.position.long.entry, "100");
  assert.equal(opened.position.realizedPnl, null);
  assert.equal(opened.leverageAssumption, "2");
  assert.equal(opened.audit.orderCreated, true);
  assert.equal(opened.audit.sequence, "1");
  assert.equal(held.futures.orders.size, 1);
  assert.equal(held.pretrade.audits.length, 1);

  const replay = checkFuturesPreTrade(held, request());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.audit, opened.audit);
  assert.equal(replay.order, opened.order);
  assert.equal(held.futures.orders.size, 1);
  assert.equal(held.pretrade.audits.length, 1);
  const read = readFuturesPreTrade(held.pretrade, {
    actor: ACTOR,
    decisionId: "fixture-decision",
  });
  assert.equal(read.idempotentReplay, false);
  assert.equal(read.audit, opened.audit);

  const cases = [
    ["fixture-leverage", "fixture-key-leverage", risk({ leverage: "2.1" }), "max leverage", "leverage cap is exceeded"],
    ["fixture-notional", "fixture-key-notional", risk({ notional: "10.1" }), "notional", "notional cap is exceeded"],
    ["fixture-buffer", "fixture-key-buffer", risk({ maintenanceMarginBuffer: "0.049" }), "margin buffer", "maintenance-margin buffer is not met"],
    ["fixture-distance", "fixture-key-distance", risk({ liquidationDistance: "0.199" }), "liquidation distance", "liquidation distance is below the floor"],
  ];
  for (const [decisionId, idempotencyKey, riskBody, reasonCode, error] of cases) {
    const denied = checkFuturesPreTrade(held, request({
      decisionId,
      idempotencyKey,
      orderId: decisionId,
      risk: riskBody,
    }));
    paper(denied);
    assert.equal(denied.ok, false, error);
    assert.equal(denied.blocked, "BLOCKED");
    assert.equal(denied.action, FUTURES_RISK_ACTION);
    assert.equal(denied.orderCreated, false);
    assert.equal(denied.reasonCode, reasonCode);
    assert.equal(denied.error, error);
    assert.equal(FUTURES_PRETRADE_REASON_CODES.includes(denied.reasonCode), true);
    assert.equal(denied.order, null);
    assert.equal(denied.audit.reasonCode, reasonCode);
    assert.equal(denied.audit.orderCreated, false);
  }
  assert.equal(held.futures.orders.size, 1);
  assert.equal(held.pretrade.audits.length, 5);
  const leverage = readFuturesPreTrade(held.pretrade, {
    actor: ACTOR,
    decisionId: "fixture-leverage",
  });
  assert.equal(leverage.leverageAssumption, "2.1");
  assert.equal(JSON.stringify(leverage).includes("10.1"), false);
  assert.equal(JSON.stringify(leverage).includes("0.049"), false);
  assert.equal(JSON.stringify(leverage).includes("0.199"), false);
  assert.equal(JSON.stringify(opened).includes("0.0025"), false);
  assert.equal(opened.position.long.quantity, "2");
});

test("a stale feed vetoes a new order and a reduce-only exit stays available", () => {
  const held = stores();
  const opened = checkFuturesPreTrade(held, request({
    feed: observation({ receiveTime: TIME + LAG }),
  }));
  assert.equal(opened.ok, true);
  assert.equal(opened.orderCreated, true);

  const stale = checkFuturesPreTrade(held, request({
    decisionId: "fixture-stale",
    idempotencyKey: "fixture-key-stale",
    orderId: "fixture-stale",
    order: order({ quantity: "1", price: "110" }),
    feed: observation({ mark: feed({ eventTime: TIME - LAG - 1 }) }),
  }));
  paper(stale);
  assert.equal(stale.ok, false);
  assert.equal(stale.reasonCode, "mark/index freshness");
  assert.equal(stale.error, "stale mark/index");
  assert.equal(stale.feedReason, "late event");
  assert.equal(stale.action, FUTURES_RISK_ACTION);
  assert.equal(stale.orderCreated, false);
  assert.equal(held.futures.orders.size, 1);
  assert.equal(opened.position.long.quantity, "2");

  const gap = checkFuturesPreTrade(held, request({
    decisionId: "fixture-gap",
    idempotencyKey: "fixture-key-gap",
    orderId: "fixture-gap",
    order: order({ quantity: "1" }),
    feed: observation({
      funding: feed({ value: "0.0001", sequence: "10", sequenceWatermark: "8" }),
    }),
  }));
  assert.equal(gap.reasonCode, "funding state");
  assert.equal(gap.error, "funding gap");
  assert.equal(gap.feedReason, "sequence gap");
  assert.equal(gap.orderCreated, false);

  const staleFunding = checkFuturesPreTrade(held, request({
    decisionId: "fixture-funding",
    idempotencyKey: "fixture-key-funding",
    orderId: "fixture-funding",
    order: order({ quantity: "1" }),
    feed: observation({
      funding: feed({
        value: "0.0001",
        sequence: "9",
        sequenceWatermark: "8",
        quality: { healthy: false, reason: "stale stream" },
      }),
    }),
  }));
  assert.equal(staleFunding.reasonCode, "funding state");
  assert.equal(staleFunding.error, "stale funding");
  assert.equal(staleFunding.orderCreated, false);
  assert.equal(held.futures.orders.size, 1);

  const exit = checkFuturesPreTrade(held, request({
    decisionId: "fixture-exit",
    idempotencyKey: "fixture-key-exit",
    orderId: "fixture-exit",
    killSwitch: true,
    order: order({ quantity: "1", price: "110", reduceOnly: true }),
    feed: observation({ mark: feed({ eventTime: TIME - LAG - 1 }) }),
  }));
  paper(exit);
  assert.equal(exit.ok, true, exit.error);
  assert.equal(exit.reasonCode, null);
  assert.equal(exit.pnl, "10");
  assert.equal(exit.formula, LINEAR_PNL);
  assert.equal(exit.position.long.quantity, "1");
  assert.equal(exit.position.realizedPnl, "10");
  assert.equal(exit.audit.reduceOnly, true);
  assert.equal(exit.audit.killSwitch, true);

  const fundingExit = checkFuturesPreTrade(held, request({
    decisionId: "fixture-funding-exit",
    idempotencyKey: "fixture-key-funding-exit",
    orderId: "fixture-funding-exit",
    order: order({ quantity: "1", price: "110", reduceOnly: true }),
    feed: observation({
      funding: feed({ value: "0.0001", sequence: "10", sequenceWatermark: "8" }),
    }),
  }));
  assert.equal(fundingExit.reasonCode, "funding state");
  assert.equal(fundingExit.orderCreated, false);
  assert.equal(exit.position.long.quantity, "1");

  const killed = checkFuturesPreTrade(held, request({
    decisionId: "fixture-kill",
    idempotencyKey: "fixture-key-kill",
    orderId: "fixture-kill",
    killSwitch: true,
    order: order({ quantity: "1", price: "100" }),
  }));
  assert.equal(killed.reasonCode, "kill switch");
  assert.equal(killed.error, "kill switch is on");
  assert.equal(killed.orderCreated, false);
  assert.equal(killed.audit.orderCreated, false);
  assert.equal(exit.position.long.quantity, "1");

  const stopped = checkFuturesPreTrade(held, request({
    decisionId: "fixture-stop",
    idempotencyKey: "fixture-key-stop",
    orderId: "fixture-stop",
    stopPolicy: { configured: false },
    order: order({ quantity: "1", price: "100" }),
  }));
  assert.equal(stopped.reasonCode, "stop policy");
  assert.equal(stopped.error, "stop policy is not configured");
  assert.equal(stopped.orderCreated, false);
  assert.equal(held.futures.orders.size, 2);

  const resumed = checkFuturesPreTrade(held, request({
    decisionId: "fixture-resume",
    idempotencyKey: "fixture-key-resume",
    orderId: "fixture-resume",
    killSwitch: false,
    order: order({ quantity: "1", price: "110", reduceOnly: true }),
  }));
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.pnl, "10");
  assert.equal(resumed.position.long, null);
  assert.equal(resumed.position.realizedPnl, "20");
  assert.equal(checkFuturesPreTrade(held, request({
    decisionId: "fixture-kill",
    idempotencyKey: "fixture-key-kill",
    orderId: "fixture-kill",
    killSwitch: true,
    order: order({ quantity: "1", price: "100" }),
  })).idempotentReplay, true);
  assert.equal(held.futures.orders.size, 3);
});

test("a veto has a reason code and does not submit a live order", () => {
  const held = stores();
  const spot = checkFuturesPreTrade(held, request({
    order: { product: "spot", state: "create", orderId: "fixture-spot-order" },
  }));
  assert.equal(spot.reasonCode, "product is not supported");
  assert.equal(spot.error, "product is not supported");
  assert.equal(spot.orderCreated, false);
  assert.equal(spot.audit, null);
  assert.equal(held.futures.orders.size, 0);
  assert.equal(JSON.stringify(spot).includes("fixture-spot-order"), false);

  const secret = checkFuturesPreTrade(held, request({
    risk: risk({ marginMode: "bearer fixture-token" }),
  }));
  assert.equal(secret.reasonCode, "secret value is not allowed");
  assert.equal(secret.audit, null);
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(held.pretrade.audits.length, 0);

  const customer = checkFuturesPreTrade(held, request({
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
  }));
  assert.equal(customer.reasonCode, "role scope denied");
  assert.equal(customer.audit, null);
  assert.equal(held.futures.orders.size, 0);

  const missingStop = checkFuturesPreTrade(held, request({ stopPolicy: {} }));
  assert.equal(missingStop.reasonCode, "stop policy");
  assert.equal(missingStop.error, "stop policy is not configured");
  const missingKill = checkFuturesPreTrade(held, request({ killSwitch: "on" }));
  assert.equal(missingKill.reasonCode, "kill switch");
  assert.equal(missingKill.error, "kill switch is not configured");
  assert.equal(held.pretrade.audits.length, 0);

  const offTick = checkFuturesPreTrade(held, request({
    order: order({ price: "100.2" }),
  }));
  paper(offTick);
  assert.equal(offTick.orderCreated, false);
  assert.equal(offTick.reasonCode, "price is not on the tick");
  assert.equal(offTick.error, "price is not on the tick");
  assert.equal(JSON.stringify(offTick).includes("100.2"), false);
  assert.equal(held.futures.orders.size, 0);
  assert.equal(offTick.audit.orderCreated, false);

  const otherFeed = checkFuturesPreTrade(held, request({
    decisionId: "fixture-other-feed",
    idempotencyKey: "fixture-key-other-feed",
    orderId: "fixture-other-feed",
    feed: observation({
      openInterest: feed({
        value: "12",
        sequence: "6",
        sequenceWatermark: "5",
        discontinuity: true,
      }),
      liquidationFeed: {
        status: "outage",
        eventTime: TIME,
        quality: { healthy: false, reason: "outage" },
        events: [],
      },
    }),
  }));
  assert.equal(otherFeed.ok, true, otherFeed.error);
  assert.equal(otherFeed.reasonCode, null);
  assert.equal(otherFeed.orderCreated, true);
  assert.equal(otherFeed.liveOrderSubmitted, false);

  const changed = checkFuturesPreTrade(held, request({
    decisionId: "fixture-other-feed",
    idempotencyKey: "fixture-key-other-feed",
    orderId: "fixture-other-feed",
    order: order({ quantity: "1" }),
  }));
  assert.equal(changed.reasonCode, "idempotency key is already recorded");
  assert.equal(changed.audit, null);
  assert.equal(held.futures.orders.size, 1);

  assert.deepEqual(FUTURES_PRETRADE_REASON_CODES, [
    "max leverage",
    "notional",
    "margin buffer",
    "mark/index freshness",
    "funding state",
    "liquidation distance",
    "stop policy",
    "kill switch",
  ]);
  assert.deepEqual(Object.keys(pretrade).sort(), [
    "FUTURES_PRETRADE_LIMITATIONS",
    "FUTURES_PRETRADE_REASON_CODES",
    "checkFuturesPreTrade",
    "createFuturesPreTradeStore",
    "readFuturesPreTrade",
  ]);
  const source = readFileSync(new URL("../services/futures-pretrade.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readFuturesRisk"), true);
  assert.equal(source.includes("evaluateFuturesFaults"), true);
  assert.equal(source.includes("appendFuturesPaperOrder"), true);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, {
    status: "ok",
    liveTrading: "OFF",
    liveOrdersLocked: true,
  });
});
