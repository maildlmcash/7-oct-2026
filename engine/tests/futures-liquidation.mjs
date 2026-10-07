import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { LINEAR_PNL, createContractStore, registerContract } from "../services/contract-specs.mjs";
import {
  FUTURES_LIQUIDATION_ASSUMPTIONS,
  FUTURES_LIQUIDATION_KINDS,
  FUTURES_LIQUIDATION_LIMITATIONS,
  createFuturesLiquidationStore,
  readFuturesLiquidationCase,
  runFuturesLiquidationCase,
} from "../services/futures-liquidation.mjs";
import * as liquidation from "../services/futures-liquidation.mjs";
import { appendFuturesPaperOrder, createFuturesPaperStore } from "../services/futures-paper.mjs";
import { FUTURES_RISK_ACTION } from "../services/futures-risk.mjs";

// Buffer, distance, and prior readings are fixtures and are NOT IN SOURCE.
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
    quantity: "1",
    price: "110",
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
    liquidation: createFuturesLiquidationStore(),
  };
}

function open(held, overrides = {}) {
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
    ...overrides,
  });
}

function run(held, overrides = {}) {
  return runFuturesLiquidationCase(held, {
    actor: ACTOR,
    caseId: "fixture-case",
    idempotencyKey: "fixture-key",
    orderId: "fixture-case-order",
    kind: "margin deterioration",
    priorMaintenanceMarginBuffer: "0.050",
    priorLiquidationDistance: "0.2",
    risk: risk(),
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
  assert.equal(result.exposureIncreased, false);
  assert.deepEqual(result.assumptions, FUTURES_LIQUIDATION_ASSUMPTIONS);
  assert.deepEqual(result.limitations, FUTURES_LIQUIDATION_LIMITATIONS);
  assert.equal(result.liquidationDistanceFormula, "NOT IN SOURCE");
}

test("margin deterioration stops exposure and reduce-only only closes", () => {
  const held = stores();
  const opened = open(held);
  assert.equal(opened.ok, true);
  assert.equal(opened.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 1);

  const deteriorated = run(held, {
    caseId: "fixture-margin",
    idempotencyKey: "fixture-key-margin",
    orderId: "fixture-margin-order",
    kind: "margin deterioration",
    priorMaintenanceMarginBuffer: "0.050",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ reduceOnly: true, quantity: "1" }),
  });
  paper(deteriorated);
  assert.equal(deteriorated.ok, false);
  assert.equal(deteriorated.blocked, "BLOCKED");
  assert.equal(deteriorated.action, FUTURES_RISK_ACTION);
  assert.equal(deteriorated.status, "margin deterioration");
  assert.equal(deteriorated.error, "margin deterioration");
  assert.deepEqual(deteriorated.warnings, ["margin deterioration"]);
  assert.equal(deteriorated.orderCreated, false);
  assert.equal(deteriorated.exposureBefore, "2");
  assert.equal(deteriorated.exposureAfter, "2");
  assert.equal(deteriorated.exposureReduced, false);
  assert.equal(deteriorated.position.long.quantity, "2");
  assert.equal(deteriorated.maintenanceMarginBuffer, "0.049");
  assert.equal(deteriorated.sequence, "1");
  assert.equal(held.futures.orders.size, 1);

  const aboveFloor = run(held, {
    caseId: "fixture-margin-prior",
    idempotencyKey: "fixture-key-margin-prior",
    orderId: "fixture-margin-prior-order",
    kind: "margin deterioration",
    priorMaintenanceMarginBuffer: "0.08",
    risk: risk({ maintenanceMarginBuffer: "0.06" }),
    order: order({ quantity: "1" }),
  });
  paper(aboveFloor);
  assert.equal(aboveFloor.status, "margin deterioration");
  assert.equal(aboveFloor.position.long.quantity, "2");
  assert.equal(aboveFloor.exposureIncreased, false);

  const steady = run(held, {
    caseId: "fixture-margin-steady",
    idempotencyKey: "fixture-key-margin-steady",
    orderId: "fixture-margin-steady-order",
    kind: "margin deterioration",
    order: order({ quantity: "1" }),
  });
  paper(steady);
  assert.equal(steady.status, "margin has not deteriorated");
  assert.equal(steady.position.long.quantity, "2");

  const closed = run(held, {
    caseId: "fixture-close",
    idempotencyKey: "fixture-key-close",
    orderId: "fixture-close-order",
    kind: "reduce-only close",
    priorMaintenanceMarginBuffer: "0.050",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ reduceOnly: true, quantity: "1", price: "110" }),
  });
  paper(closed);
  assert.equal(closed.ok, true);
  assert.equal(closed.blocked, null);
  assert.equal(closed.action, null);
  assert.equal(closed.status, "reduce-only close");
  assert.equal(closed.error, null);
  assert.deepEqual(closed.warnings, ["margin deterioration"]);
  assert.equal(closed.orderCreated, true);
  assert.equal(closed.pnl, "10");
  assert.equal(closed.formula, LINEAR_PNL);
  assert.equal(closed.exposureBefore, "2");
  assert.equal(closed.exposureAfter, "1");
  assert.equal(closed.exposureReduced, true);
  assert.equal(closed.position.long.quantity, "1");
  assert.equal(closed.position.long.entry, "100");
  assert.equal(closed.position.realizedPnl, "10");
  assert.equal(held.futures.orders.size, 2);

  const replay = run(held, {
    caseId: "fixture-close",
    idempotencyKey: "fixture-key-close",
    orderId: "fixture-close-order",
    kind: "reduce-only close",
    priorMaintenanceMarginBuffer: "0.050",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ reduceOnly: true, quantity: "1", price: "110" }),
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.position, closed.position);
  assert.equal(replay.position.long.quantity, "1");
  assert.equal(held.futures.orders.size, 2);
  const viewed = readFuturesLiquidationCase(held.liquidation, {
    actor: ACTOR,
    caseId: "fixture-close",
  });
  assert.equal(viewed.idempotentReplay, false);
  assert.equal(viewed.status, "reduce-only close");
  assert.equal(viewed.position.long.quantity, "1");

  const wrongSide = run(held, {
    caseId: "fixture-wrong-side",
    idempotencyKey: "fixture-key-wrong-side",
    orderId: "fixture-wrong-side-order",
    kind: "reduce-only close",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ direction: "short", reduceOnly: true, quantity: "1" }),
  });
  paper(wrongSide);
  assert.equal(wrongSide.ok, false);
  assert.equal(wrongSide.status, "reduce-only side does not match");
  assert.equal(wrongSide.action, FUTURES_RISK_ACTION);
  assert.equal(wrongSide.position.long.quantity, "1");
  assert.equal(wrongSide.exposureAfter, "1");
  assert.equal(held.futures.orders.size, 2);

  const larger = run(held, {
    caseId: "fixture-larger",
    idempotencyKey: "fixture-key-larger",
    orderId: "fixture-larger-order",
    kind: "reduce-only close",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ reduceOnly: true, quantity: "2" }),
  });
  paper(larger);
  assert.equal(larger.status, "reduce-only quantity is larger than the position");
  assert.equal(larger.position.long.quantity, "1");
  assert.equal(held.futures.orders.size, 2);

  const increase = run(held, {
    caseId: "fixture-increase",
    idempotencyKey: "fixture-key-increase",
    orderId: "fixture-increase-order",
    kind: "reduce-only close",
    order: order({ reduceOnly: false, quantity: "1" }),
  });
  paper(increase);
  assert.equal(increase.status, "reduce-only is not set");
  assert.equal(increase.position.long.quantity, "1");
  assert.equal(held.futures.orders.size, 2);

  const changed = run(held, {
    caseId: "fixture-close-other",
    idempotencyKey: "fixture-key-close",
    orderId: "fixture-close-order",
    kind: "reduce-only close",
    order: order({ reduceOnly: true, quantity: "1" }),
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.status, "idempotency key is already recorded");
  assert.equal(changed.position, null);
  assert.equal(held.futures.orders.size, 2);
  assert.equal(held.liquidation.cases.size, 7);
});

test("liquidation-distance warning stops and a later reduce-only close does not increase", () => {
  const held = stores();
  assert.equal(open(held).position.long.quantity, "2");

  const calm = run(held, {
    caseId: "fixture-distance-calm",
    idempotencyKey: "fixture-key-distance-calm",
    orderId: "fixture-distance-calm-order",
    kind: "liquidation-distance warning",
    order: order({ quantity: "1" }),
  });
  paper(calm);
  assert.equal(calm.status, "liquidation distance is not a warning");
  assert.deepEqual(calm.warnings, []);
  assert.equal(calm.position.long.quantity, "2");

  const nearer = run(held, {
    caseId: "fixture-distance-near",
    idempotencyKey: "fixture-key-distance-near",
    orderId: "fixture-distance-near-order",
    kind: "liquidation-distance warning",
    priorLiquidationDistance: "0.3",
    risk: risk({ liquidationDistance: "0.25" }),
    order: order({ quantity: "1" }),
  });
  paper(nearer);
  assert.equal(nearer.status, "liquidation-distance warning");
  assert.equal(nearer.blocked, "BLOCKED");
  assert.equal(nearer.action, FUTURES_RISK_ACTION);
  assert.deepEqual(nearer.warnings, ["liquidation-distance warning"]);
  assert.equal(nearer.liquidationDistance, "0.25");
  assert.equal(nearer.position.long.quantity, "2");
  assert.equal(nearer.exposureIncreased, false);

  const below = run(held, {
    caseId: "fixture-distance-floor",
    idempotencyKey: "fixture-key-distance-floor",
    orderId: "fixture-distance-floor-order",
    kind: "liquidation-distance warning",
    risk: risk({ liquidationDistance: "0.199" }),
    order: order({ reduceOnly: false, quantity: "1" }),
  });
  paper(below);
  assert.equal(below.status, "liquidation-distance warning");
  assert.equal(below.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 1);

  const closed = run(held, {
    caseId: "fixture-distance-close",
    idempotencyKey: "fixture-key-distance-close",
    orderId: "fixture-distance-close-order",
    kind: "reduce-only close",
    risk: risk({ liquidationDistance: "0.199" }),
    order: order({ reduceOnly: true, quantity: "2", price: "110" }),
  });
  paper(closed);
  assert.equal(closed.status, "reduce-only close");
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.warnings, ["liquidation-distance warning"]);
  assert.equal(closed.pnl, "20");
  assert.equal(closed.formula, LINEAR_PNL);
  assert.equal(closed.exposureBefore, "2");
  assert.equal(closed.exposureAfter, "0");
  assert.equal(closed.exposureReduced, true);
  assert.equal(closed.exposureIncreased, false);
  assert.equal(closed.position.long, null);
  assert.equal(closed.position.realizedPnl, "20");

  const again = run(held, {
    caseId: "fixture-distance-again",
    idempotencyKey: "fixture-key-distance-again",
    orderId: "fixture-distance-again-order",
    kind: "reduce-only close",
    risk: risk({ liquidationDistance: "0.199" }),
    order: order({ reduceOnly: true, quantity: "1" }),
  });
  paper(again);
  assert.equal(again.status, "reduce-only has no position");
  assert.equal(again.exposureAfter, "0");
  assert.equal(held.futures.orders.size, 2);

  const hedgeBook = stores();
  assert.equal(open(hedgeBook, {
    orderId: "fixture-hedge-long",
    idempotencyKey: "fixture-key-hedge-long",
    positionMode: "hedge",
  }).ok, true);
  assert.equal(open(hedgeBook, {
    orderId: "fixture-hedge-short",
    idempotencyKey: "fixture-key-hedge-short",
    direction: "short",
    positionMode: "hedge",
  }).position.short.quantity, "2");
  const hedgeClose = run(hedgeBook, {
    caseId: "fixture-hedge-close",
    idempotencyKey: "fixture-key-hedge-close",
    orderId: "fixture-hedge-close-order",
    kind: "reduce-only close",
    risk: risk({ maintenanceMarginBuffer: "0.049", liquidationDistance: "0.199" }),
    order: order({ reduceOnly: true, quantity: "1", positionMode: "hedge" }),
  });
  paper(hedgeClose);
  assert.equal(hedgeClose.status, "reduce-only close");
  assert.deepEqual(hedgeClose.warnings, ["margin deterioration", "liquidation-distance warning"]);
  assert.equal(hedgeClose.pnl, "10");
  assert.equal(hedgeClose.exposureBefore, "4");
  assert.equal(hedgeClose.exposureAfter, "3");
  assert.equal(hedgeClose.exposureIncreased, false);
  assert.equal(hedgeClose.position.long.quantity, "1");
  assert.equal(hedgeClose.position.short.quantity, "2");
});

test("position-mode mismatch stops and unsafe inputs do not change exposure", () => {
  const held = stores();
  assert.equal(open(held).position.long.quantity, "2");

  const mismatch = run(held, {
    caseId: "fixture-mode",
    idempotencyKey: "fixture-key-mode",
    orderId: "fixture-mode-order",
    kind: "position-mode mismatch",
    risk: risk({ maintenanceMarginBuffer: "0.049" }),
    order: order({ positionMode: "hedge", reduceOnly: true, quantity: "1" }),
  });
  paper(mismatch);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.blocked, "BLOCKED");
  assert.equal(mismatch.action, FUTURES_RISK_ACTION);
  assert.equal(mismatch.status, "position mode does not match");
  assert.equal(mismatch.position.long.quantity, "2");
  assert.equal(mismatch.position.positionMode, "one-way");
  assert.equal(held.futures.orders.size, 1);

  const closeMismatch = run(held, {
    caseId: "fixture-mode-close",
    idempotencyKey: "fixture-key-mode-close",
    orderId: "fixture-mode-close-order",
    kind: "reduce-only close",
    order: order({ positionMode: "hedge", reduceOnly: true, quantity: "1" }),
  });
  paper(closeMismatch);
  assert.equal(closeMismatch.status, "position mode does not match");
  assert.equal(closeMismatch.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 1);

  const sameMode = run(held, {
    caseId: "fixture-mode-same",
    idempotencyKey: "fixture-key-mode-same",
    orderId: "fixture-mode-same-order",
    kind: "position-mode mismatch",
    order: order({ positionMode: "one-way", reduceOnly: true, quantity: "1" }),
  });
  paper(sameMode);
  assert.equal(sameMode.status, "position mode matches");
  assert.equal(sameMode.position.long.quantity, "2");

  const marginMismatch = run(held, {
    caseId: "fixture-margin-mode",
    idempotencyKey: "fixture-key-margin-mode",
    orderId: "fixture-margin-mode-order",
    kind: "reduce-only close",
    order: order({ marginMode: "cross", reduceOnly: true, quantity: "1" }),
  });
  paper(marginMismatch);
  assert.equal(marginMismatch.status, "margin mode does not match");
  assert.equal(marginMismatch.position.long.quantity, "2");
  assert.equal(held.futures.orders.size, 1);

  const empty = stores();
  const absent = run(empty, {
    caseId: "fixture-absent",
    idempotencyKey: "fixture-key-absent",
    orderId: "fixture-absent-order",
    kind: "position-mode mismatch",
    order: order({ positionMode: "hedge" }),
  });
  paper(absent);
  assert.equal(absent.status, "position is not open");
  assert.equal(absent.position, null);
  assert.equal(absent.exposureBefore, "0");
  assert.equal(empty.futures.orders.size, 0);

  const spot = run(held, {
    caseId: "fixture-spot",
    idempotencyKey: "fixture-key-spot",
    orderId: "fixture-spot-case",
    order: {
      product: "spot",
      state: "open",
      orderId: "fixture-spot-order",
    },
  });
  assert.equal(spot.ok, false);
  assert.equal(spot.status, "product is not supported");
  assert.equal(spot.position, null);
  assert.equal(JSON.stringify(spot).includes("fixture-spot-order"), false);
  assert.equal(held.futures.orders.size, 1);

  const secret = run(held, {
    caseId: "fixture-secret",
    idempotencyKey: "fixture-key-secret",
    orderId: "fixture-secret-order",
    risk: risk({ marginMode: "bearer fixture-token" }),
  });
  assert.equal(secret.status, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(held.liquidation.cases.has("fixture-tenant\u0000fixture-secret"), false);

  const tick = run(held, {
    caseId: "fixture-tick",
    idempotencyKey: "fixture-key-tick",
    orderId: "fixture-tick-order",
    kind: "reduce-only close",
    order: order({ reduceOnly: true, quantity: "1", price: "100.2" }),
  });
  paper(tick);
  assert.equal(tick.status, "price is not on the tick");
  assert.equal(tick.position.long.quantity, "2");
  assert.equal(JSON.stringify(tick).includes("100.2"), false);
  assert.equal(held.futures.orders.size, 1);

  const customerHeld = stores();
  const customer = runFuturesLiquidationCase(customerHeld, {
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
    caseId: "fixture-customer-case",
    idempotencyKey: "fixture-key-customer",
    orderId: "fixture-customer-order",
    kind: "reduce-only close",
    priorMaintenanceMarginBuffer: "0.050",
    priorLiquidationDistance: "0.2",
    risk: risk(),
    order: order({ reduceOnly: true }),
  });
  assert.equal(customer.status, "role scope denied");
  assert.equal(customerHeld.liquidation.cases.size, 0);
  assert.equal(customerHeld.futures.orders.size, 0);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  const source = readFileSync(new URL("../services/futures-liquidation.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readFuturesRisk"), true);
  assert.equal(source.includes("appendFuturesPaperOrder"), true);
  assert.equal(source.includes("checkFuturesPreTrade"), false);
  assert.equal(source.includes("readSpotDepthView"), false);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(Object.keys(liquidation).sort(), [
    "FUTURES_LIQUIDATION_ASSUMPTIONS",
    "FUTURES_LIQUIDATION_KINDS",
    "FUTURES_LIQUIDATION_LIMITATIONS",
    "createFuturesLiquidationStore",
    "readFuturesLiquidationCase",
    "runFuturesLiquidationCase",
  ]);
  assert.deepEqual(FUTURES_LIQUIDATION_KINDS, [
    "margin deterioration",
    "liquidation-distance warning",
    "reduce-only close",
    "position-mode mismatch",
  ]);
});
