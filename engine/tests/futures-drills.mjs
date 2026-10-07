import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { LINEAR_PNL, createContractStore, registerContract } from "../services/contract-specs.mjs";
import {
  FUTURES_DRILL_LIMITATIONS,
  FUTURES_DRILL_SCENARIOS,
  attemptFuturesDrillOrder,
  createFuturesDrillStore,
  injectFuturesDrill,
  readFuturesDrill,
  reconcileFuturesDrill,
} from "../services/futures-drills.mjs";
import * as drills from "../services/futures-drills.mjs";
import { appendFuturesPaperOrder, createFuturesPaperStore } from "../services/futures-paper.mjs";

// Lag 1000 and funding interval 8 are fixtures and are NOT IN SOURCE.
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
    receiveTime: TIME + 1,
    lagThreshold: LAG,
    mark: feed(),
    index: feed({ sequence: "4", sequenceWatermark: "3" }),
    funding: feed({ value: "0.0001", sequence: "9", sequenceWatermark: "8" }),
    openInterest: feed({
      value: "1000000",
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

function order(overrides = {}) {
  return {
    contractId: "fixture-linear-perpetual",
    direction: "long",
    quantity: "1",
    price: "100",
    reduceOnly: false,
    positionMode: "one-way",
    marginMode: "isolated",
    product: "futures",
    ...overrides,
  };
}

function stores() {
  const book = createContractStore();
  assert.equal(registerContract(book, contract()).ok, true);
  return {
    contracts: book,
    futures: createFuturesPaperStore(),
    drills: createFuturesDrillStore(),
  };
}

function open(held) {
  return appendFuturesPaperOrder(held, {
    actor: ACTOR,
    orderId: "fixture-open",
    idempotencyKey: "fixture-key-open",
    contractId: "fixture-linear-perpetual",
    direction: "long",
    quantity: "2",
    price: "100",
    reduceOnly: false,
    positionMode: "one-way",
    marginMode: "isolated",
    product: "futures",
  });
}

function inject(held, overrides = {}) {
  return injectFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-drill",
    idempotencyKey: "fixture-key-drill",
    scenario: "missing mark price",
    contractId: "fixture-linear-perpetual",
    feed: observation({ mark: feed({ value: "" }) }),
    ...overrides,
  });
}

function attempt(held, overrides = {}) {
  return attemptFuturesDrillOrder(held, {
    actor: ACTOR,
    drillId: "fixture-drill",
    idempotencyKey: "fixture-key-attempt",
    orderId: "fixture-attempt",
    order: order(),
    ...overrides,
  });
}

function paper(result) {
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.equal(result.timeoutApplied, false);
  assert.equal(result.retried, false);
  assert.equal(result.restored, false);
  assert.deepEqual(result.limitations, FUTURES_DRILL_LIMITATIONS);
  assert.equal(JSON.stringify(result).includes("0.0025"), false);
  assert.equal(JSON.stringify(result).includes("\"22\""), false);
}

test("missing mark disables new risk until data and state reconcile", () => {
  const held = stores();
  assert.equal(open(held).position.long.quantity, "2");
  const absent = inject(held, {
    drillId: "fixture-present",
    idempotencyKey: "fixture-key-present",
    feed: observation(),
  });
  assert.equal(absent.status, "mark price is present");
  assert.equal(held.drills.drills.size, 0);

  const drilled = inject(held);
  paper(drilled);
  assert.equal(drilled.ok, true);
  assert.equal(drilled.alert, true);
  assert.equal(drilled.fault, "missing mark price");
  assert.equal(drilled.reason, "missing mark price");
  assert.equal(drilled.state, "abstain");
  assert.equal(drilled.status, "missing mark price");
  assert.equal(drilled.newRiskEnabled, false);
  assert.equal(drilled.dataReconciled, false);
  assert.equal(drilled.stateReconciled, false);
  assert.equal(drilled.positionQuantity, "2");
  assert.equal(drilled.sequence, "1");
  assert.equal(held.drills.alerts.length, 1);
  assert.equal(held.drills.alerts[0].alert, true);

  const replay = inject(held);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.sequence, "1");
  assert.equal(held.drills.alerts.length, 1);
  assert.equal(held.futures.orders.size, 1);

  const added = attempt(held);
  paper(added);
  assert.equal(added.ok, false);
  assert.equal(added.blocked, "BLOCKED");
  assert.equal(added.status, "new risk disabled");
  assert.equal(added.orderCreated, false);
  assert.equal(added.exposureIncreased, false);
  assert.equal(added.position.long.quantity, "2");
  assert.equal(added.newRiskEnabled, false);
  assert.equal(held.futures.orders.size, 1);

  const closed = attempt(held, {
    idempotencyKey: "fixture-key-close",
    orderId: "fixture-close",
    order: order({ reduceOnly: true, quantity: "1", price: "110" }),
  });
  paper(closed);
  assert.equal(closed.ok, true);
  assert.equal(closed.status, "reduce-only close");
  assert.equal(closed.pnl, "10");
  assert.equal(closed.formula, LINEAR_PNL);
  assert.equal(closed.position.long.quantity, "1");
  assert.equal(closed.exposureIncreased, false);
  assert.equal(closed.newRiskEnabled, false);
  assert.equal(closed.alert, true);
  assert.equal(held.futures.orders.size, 2);

  const wrongQuantity = reconcileFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-drill",
    state: { positionQuantity: "2" },
  });
  paper(wrongQuantity);
  assert.equal(wrongQuantity.ok, false);
  assert.equal(wrongQuantity.status, "position quantity does not match");
  assert.equal(wrongQuantity.statedPositionQuantity, "2");
  assert.equal(wrongQuantity.positionQuantity, "1");
  assert.equal(wrongQuantity.newRiskEnabled, false);

  const dataOnly = reconcileFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-drill",
    data: observation(),
  });
  paper(dataOnly);
  assert.equal(dataOnly.dataReconciled, true);
  assert.equal(dataOnly.stateReconciled, false);
  assert.equal(dataOnly.status, "state is not reconciled");
  assert.equal(dataOnly.newRiskEnabled, false);
  assert.equal(attempt(held, {
    idempotencyKey: "fixture-key-still",
    orderId: "fixture-still",
  }).status, "new risk disabled");
  assert.equal(held.futures.orders.size, 2);

  const ready = reconcileFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-drill",
    state: { positionQuantity: "1" },
  });
  paper(ready);
  assert.equal(ready.status, "reconciled");
  assert.equal(ready.newRiskEnabled, true);
  assert.equal(ready.alert, false);
  assert.equal(held.drills.alerts[0].alert, true);
  const viewed = readFuturesDrill(held.drills, { actor: ACTOR, drillId: "fixture-drill" });
  assert.equal(viewed.newRiskEnabled, true);
  assert.equal(viewed.idempotentReplay, false);

  const resumed = attempt(held, {
    idempotencyKey: "fixture-key-resume",
    orderId: "fixture-resume",
    order: order({ quantity: "1", price: "100" }),
  });
  paper(resumed);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.status, "simulated");
  assert.equal(resumed.orderCreated, true);
  assert.equal(resumed.exposureIncreased, true);
  assert.equal(resumed.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 3);
});

test("funding outage, stream gap, and worker restart keep the latch until both sides reconcile", () => {
  const fundingHeld = stores();
  assert.equal(open(fundingHeld).position.long.quantity, "2");
  const funding = inject(fundingHeld, {
    drillId: "fixture-funding",
    idempotencyKey: "fixture-key-funding",
    scenario: "funding outage",
    feed: observation({
      funding: feed({
        value: "0.0001",
        sequence: "9",
        sequenceWatermark: "8",
        quality: { healthy: false, reason: "outage" },
      }),
    }),
  });
  paper(funding);
  assert.equal(funding.alert, true);
  assert.equal(funding.fault, "funding outage");
  assert.equal(funding.reason, "outage");
  assert.equal(funding.state, "abstain");
  assert.equal(funding.newRiskEnabled, false);
  const fundingAdd = attempt(fundingHeld, { drillId: "fixture-funding" });
  paper(fundingAdd);
  assert.equal(fundingAdd.status, "new risk disabled");
  assert.equal(fundingAdd.position.long.quantity, "2");
  const fundingClose = attempt(fundingHeld, {
    drillId: "fixture-funding",
    idempotencyKey: "fixture-key-funding-close",
    orderId: "fixture-funding-close",
    order: order({ reduceOnly: true, quantity: "1", price: "110" }),
  });
  paper(fundingClose);
  assert.equal(fundingClose.status, "new risk disabled");
  assert.equal(fundingClose.position.long.quantity, "2");
  assert.equal(fundingHeld.futures.orders.size, 1);
  const fundingData = reconcileFuturesDrill(fundingHeld, {
    actor: ACTOR,
    drillId: "fixture-funding",
    data: observation(),
  });
  assert.equal(fundingData.status, "state is not reconciled");
  assert.equal(fundingData.newRiskEnabled, false);
  const fundingBad = reconcileFuturesDrill(fundingHeld, {
    actor: ACTOR,
    drillId: "fixture-funding",
    state: { positionQuantity: "3" },
  });
  assert.equal(fundingBad.status, "position quantity does not match");
  assert.equal(fundingBad.statedPositionQuantity, "3");
  assert.equal(fundingBad.newRiskEnabled, false);
  const fundingReady = reconcileFuturesDrill(fundingHeld, {
    actor: ACTOR,
    drillId: "fixture-funding",
    state: { positionQuantity: "2" },
  });
  assert.equal(fundingReady.status, "reconciled");
  assert.equal(fundingReady.newRiskEnabled, true);
  const fundingResume = attempt(fundingHeld, {
    drillId: "fixture-funding",
    idempotencyKey: "fixture-key-funding-resume",
    orderId: "fixture-funding-resume",
  });
  paper(fundingResume);
  assert.equal(fundingResume.status, "simulated");
  assert.equal(fundingResume.position.long.quantity, "3");
  assert.equal(fundingHeld.futures.orders.size, 2);

  const gapHeld = stores();
  assert.equal(open(gapHeld).ok, true);
  const quiet = inject(gapHeld, {
    drillId: "fixture-gap-quiet",
    idempotencyKey: "fixture-key-gap-quiet",
    scenario: "stream gap",
    feed: observation(),
  });
  assert.equal(quiet.status, "stream gap is not present");
  assert.equal(gapHeld.drills.drills.size, 0);
  const gap = inject(gapHeld, {
    drillId: "fixture-gap",
    idempotencyKey: "fixture-key-gap",
    scenario: "stream gap",
    feed: observation({ mark: feed({ sequence: "10", sequenceWatermark: "8" }) }),
  });
  paper(gap);
  assert.equal(gap.alert, true);
  assert.equal(gap.reason, "sequence gap");
  assert.equal(gap.state, "abstain");
  assert.equal(gap.newRiskEnabled, false);
  assert.equal(attempt(gapHeld, { drillId: "fixture-gap" }).status, "new risk disabled");
  assert.equal(gapHeld.futures.orders.size, 1);
  const gapData = reconcileFuturesDrill(gapHeld, {
    actor: ACTOR,
    drillId: "fixture-gap",
    data: observation({ mark: feed({ sequence: "10", sequenceWatermark: "8" }) }),
  });
  assert.equal(gapData.dataReconciled, false);
  assert.equal(gapData.status, "data is not reconciled");
  assert.equal(gapData.newRiskEnabled, false);
  const gapReady = reconcileFuturesDrill(gapHeld, {
    actor: ACTOR,
    drillId: "fixture-gap",
    data: observation(),
    state: { positionQuantity: "2" },
  });
  assert.equal(gapReady.status, "reconciled");
  assert.equal(gapReady.newRiskEnabled, true);
  assert.equal(attempt(gapHeld, {
    drillId: "fixture-gap",
    idempotencyKey: "fixture-key-gap-resume",
    orderId: "fixture-gap-resume",
  }).position.long.quantity, "3");

  const restartHeld = stores();
  assert.equal(open(restartHeld).ok, true);
  const restart = inject(restartHeld, {
    drillId: "fixture-restart",
    idempotencyKey: "fixture-key-restart",
    scenario: "worker restart",
    feed: observation(),
  });
  paper(restart);
  assert.equal(restart.alert, true);
  assert.equal(restart.fault, "worker restart");
  assert.equal(restart.reason, "worker restart");
  assert.equal(restart.state, "abstain");
  assert.equal(restart.restored, false);
  assert.equal(restart.newRiskEnabled, false);
  assert.equal(restartHeld.futures.orders.size, 1);
  assert.equal(attempt(restartHeld, { drillId: "fixture-restart" }).status, "new risk disabled");
  assert.equal(restartHeld.futures.orders.size, 1);
  const restartState = reconcileFuturesDrill(restartHeld, {
    actor: ACTOR,
    drillId: "fixture-restart",
    state: { positionQuantity: "2" },
  });
  assert.equal(restartState.status, "data is not reconciled");
  assert.equal(restartState.newRiskEnabled, false);
  const restartReady = reconcileFuturesDrill(restartHeld, {
    actor: ACTOR,
    drillId: "fixture-restart",
    data: observation(),
  });
  assert.equal(restartReady.status, "reconciled");
  assert.equal(restartReady.restored, false);
  assert.equal(attempt(restartHeld, {
    drillId: "fixture-restart",
    idempotencyKey: "fixture-key-restart-resume",
    orderId: "fixture-restart-resume",
  }).position.long.quantity, "3");
});

test("order timeout is not retried and unsafe inputs do not enable new risk", () => {
  const held = stores();
  assert.equal(open(held).ok, true);
  const missing = inject(held, {
    drillId: "fixture-missing-order",
    idempotencyKey: "fixture-key-missing-order",
    scenario: "order timeout",
    orderId: "fixture-absent-order",
    feed: observation(),
  });
  assert.equal(missing.status, "order is not configured");
  assert.equal(held.drills.drills.size, 0);
  const clock = injectFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-clock",
    idempotencyKey: "fixture-key-clock",
    scenario: "order timeout",
    contractId: "fixture-linear-perpetual",
    orderId: "fixture-open",
    feed: observation(),
    clock: 1,
  });
  assert.equal(clock.status, "unsupported field");
  assert.equal(held.drills.drills.size, 0);
  assert.equal(held.futures.orders.size, 1);

  const timeout = inject(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-timeout",
    scenario: "order timeout",
    orderId: "fixture-open",
    feed: observation(),
  });
  paper(timeout);
  assert.equal(timeout.alert, true);
  assert.equal(timeout.fault, "order timeout");
  assert.equal(timeout.status, "unknown pending reconciliation");
  assert.equal(timeout.reason, "unknown pending reconciliation");
  assert.equal(timeout.timeoutApplied, false);
  assert.equal(timeout.retried, false);
  assert.equal(timeout.newRiskEnabled, false);
  assert.equal(timeout.positionQuantity, "2");
  const same = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-retry",
    orderId: "fixture-open",
  });
  paper(same);
  assert.equal(same.status, "unknown pending reconciliation");
  assert.equal(same.retried, false);
  assert.equal(same.orderCreated, false);
  assert.equal(held.futures.orders.size, 1);
  const other = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-other",
    orderId: "fixture-other",
  });
  assert.equal(other.status, "unknown pending reconciliation");
  assert.equal(held.futures.orders.size, 1);

  const ready = reconcileFuturesDrill(held, {
    actor: ACTOR,
    drillId: "fixture-timeout",
    data: observation(),
    state: { positionQuantity: "2" },
  });
  paper(ready);
  assert.equal(ready.status, "reconciled");
  assert.equal(ready.newRiskEnabled, true);
  const retry = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-retry-again",
    orderId: "fixture-open",
    order: order({ quantity: "1" }),
  });
  paper(retry);
  assert.equal(retry.status, "unknown pending reconciliation");
  assert.equal(retry.retried, false);
  assert.equal(retry.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 1);
  const resumed = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-timeout-resume",
    orderId: "fixture-timeout-resume",
  });
  paper(resumed);
  assert.equal(resumed.status, "simulated");
  assert.equal(resumed.position.long.quantity, "3");
  assert.equal(held.futures.orders.size, 2);

  const spot = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-spot",
    orderId: "fixture-spot-case",
    order: { product: "spot", state: "open", orderId: "fixture-spot-order" },
  });
  assert.equal(spot.status, "product is not supported");
  assert.equal(JSON.stringify(spot).includes("fixture-spot-order"), false);
  assert.equal(held.futures.orders.size, 2);

  const tick = attempt(held, {
    drillId: "fixture-timeout",
    idempotencyKey: "fixture-key-tick",
    orderId: "fixture-tick",
    order: order({ price: "100.2" }),
  });
  paper(tick);
  assert.equal(tick.status, "price is not on the tick");
  assert.equal(tick.position.long.quantity, "3");
  assert.equal(JSON.stringify(tick).includes("100.2"), false);
  assert.equal(held.futures.orders.size, 2);

  const secret = inject(held, {
    drillId: "fixture-secret",
    idempotencyKey: "fixture-key-secret",
    feed: observation({ mark: feed({ value: "bearer fixture-token" }) }),
  });
  assert.equal(secret.status, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(held.drills.drills.has("fixture-tenant\u0000fixture-secret"), false);

  const customerHeld = stores();
  const customer = injectFuturesDrill(customerHeld, {
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
    drillId: "fixture-customer",
    idempotencyKey: "fixture-key-customer",
    scenario: "worker restart",
    contractId: "fixture-linear-perpetual",
    feed: observation(),
  });
  assert.equal(customer.status, "role scope denied");
  assert.equal(customerHeld.drills.drills.size, 0);
  assert.equal(customerHeld.futures.orders.size, 0);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  const source = readFileSync(new URL("../services/futures-drills.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("evaluateFuturesFaults"), true);
  assert.equal(source.includes("appendFuturesPaperOrder"), true);
  assert.equal(source.includes("readFuturesPaperPosition"), true);
  assert.equal(source.includes("checkFuturesPreTrade"), false);
  assert.equal(source.includes("readSpotDepthView"), false);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(Object.keys(drills).sort(), [
    "FUTURES_DRILL_LIMITATIONS",
    "FUTURES_DRILL_SCENARIOS",
    "attemptFuturesDrillOrder",
    "createFuturesDrillStore",
    "injectFuturesDrill",
    "readFuturesDrill",
    "reconcileFuturesDrill",
  ]);
  assert.deepEqual(FUTURES_DRILL_SCENARIOS, [
    "missing mark price",
    "funding outage",
    "stream gap",
    "worker restart",
    "order timeout",
  ]);
});
