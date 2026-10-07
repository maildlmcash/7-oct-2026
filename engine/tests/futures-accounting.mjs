import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  INVERSE_PNL,
  LINEAR_PNL,
  convertContractPnl,
  createContractStore,
  registerContract,
} from "../services/contract-specs.mjs";
import {
  FUTURES_ACCOUNTING_ASSUMPTIONS,
  FUTURES_ACCOUNTING_LIMITATIONS,
  FUTURES_ACCOUNTING_PNL,
  FUTURES_ACCOUNTING_VERSION,
  FUTURES_FILL_FEE,
  FUTURES_FILL_NOTIONAL_INVERSE,
  FUTURES_FILL_NOTIONAL_LINEAR,
  createFuturesAccountingStore,
  postFuturesAccounting,
  readFuturesAccounting,
} from "../services/futures-accounting.mjs";
import * as accounting from "../services/futures-accounting.mjs";

// Fee rate 0.001, funding amounts, and funding interval 8 are fixtures.
// They are NOT IN SOURCE. The interval is not converted into a payment.
const TIME = 1499865549590;
const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };

function contract(overrides) {
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
    ...overrides,
  };
}

function contracts() {
  const store = createContractStore();
  assert.equal(registerContract(store, contract({})).ok, true);
  assert.equal(registerContract(store, contract({
    id: "fixture-inverse-perpetual",
    style: "inverse",
    quote: "USD",
    settlementCurrency: "BTC",
  })).ok, true);
  assert.equal(registerContract(store, contract({
    id: "fixture-inverse-dated",
    style: "inverse",
    tenor: "dated",
    quote: "USD",
    settlementCurrency: "BTC",
    multiplier: "10",
    tickSize: "1",
    expiry: String(TIME),
    fundingInterval: null,
  })).ok, true);
  return store;
}

function stores() {
  return { contracts: contracts(), accounting: createFuturesAccountingStore() };
}

function statement(positionQuantity, positionValue, fees, funding, pnl) {
  return { positionQuantity, positionValue, fees, funding, pnl };
}

function post(book, body) {
  return postFuturesAccounting(book, {
    actor: ACTOR,
    assumptionsVersion: FUTURES_ACCOUNTING_VERSION,
    product: "futures",
    ...body,
  });
}

function paper(result) {
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.equal(result.promoted, false);
  assert.equal(result.assumptionsVersion, "contract-units");
  assert.deepEqual(result.assumptions, FUTURES_ACCOUNTING_ASSUMPTIONS);
  assert.deepEqual(result.limitations, FUTURES_ACCOUNTING_LIMITATIONS);
}

test("linear partial fills, fees, funding, and mark reconcile", () => {
  const book = stores();
  const opened = post(book, {
    accountId: "fixture-linear",
    idempotencyKey: "fixture-key-open",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "5",
    feeRate: "0.001",
    bids: [{ price: "99.5", quantity: "1" }],
    asks: [{ price: "100", quantity: "3" }, { price: "110", quantity: "1" }],
    mark: "110",
    statement: statement("4", "30", "0.41", "0", "29.59"),
  });
  paper(opened);
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.reconciled, true);
  assert.equal(opened.alert, false);
  assert.equal(opened.state, "partial fill");
  assert.equal(opened.partial, true);
  assert.equal(opened.filledQuantity, "4");
  assert.equal(opened.unfilledQuantity, "1");
  assert.equal(opened.positionQuantity, "4");
  assert.equal(opened.positionSide, "long");
  assert.equal(opened.positionValue, "30");
  assert.equal(opened.fees, "0.41");
  assert.equal(opened.eventFee, "0.41");
  assert.equal(opened.funding, "0");
  assert.equal(opened.pnl, "29.59");
  assert.equal(opened.formula, LINEAR_PNL);
  assert.equal(opened.notionalFormula, FUTURES_FILL_NOTIONAL_LINEAR);
  assert.equal(opened.feeFormula, FUTURES_FILL_FEE);
  assert.equal(opened.pnlFormula, FUTURES_ACCOUNTING_PNL);
  assert.equal(opened.settlement, "USDT");
  assert.equal(opened.quantityUnit, "BTC");
  assert.equal(opened.multiplier, "1");
  assert.equal(opened.fundingInterval, "8");
  assert.equal(opened.fundingIntervalApplied, false);
  assert.deepEqual(opened.lots, [
    { side: "long", quantity: "3", entry: "100" },
    { side: "long", quantity: "1", entry: "110" },
  ]);
  const wide = convertContractPnl(book.contracts, {
    contractId: "fixture-linear-perpetual",
    side: "long",
    quantity: "3",
    entryPrice: "100",
    exitPrice: "110",
  });
  assert.equal(wide.pnl, "30");
  assert.equal(opened.positionValue, wide.pnl);

  const replay = post(book, {
    accountId: "fixture-linear",
    idempotencyKey: "fixture-key-open",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "5",
    feeRate: "0.001",
    bids: [{ price: "99.5", quantity: "1" }],
    asks: [{ price: "100", quantity: "3" }, { price: "110", quantity: "1" }],
    mark: "110",
    statement: statement("4", "30", "0.41", "0", "29.59"),
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.report, opened.report);
  assert.equal(opened.positionQuantity, "4");

  const funded = post(book, {
    accountId: "fixture-linear",
    idempotencyKey: "fixture-key-funding",
    contractId: "fixture-linear-perpetual",
    kind: "funding",
    amount: "-0.1",
    statement: statement("4", "30", "0.41", "-0.1", "29.49"),
  });
  paper(funded);
  assert.equal(funded.ok, true, funded.error);
  assert.equal(funded.state, "funding");
  assert.equal(funded.eventFunding, "-0.1");
  assert.equal(funded.funding, "-0.1");
  assert.equal(funded.fees, "0.41");
  assert.equal(funded.positionValue, "30");
  assert.equal(funded.pnl, "29.49");
  assert.equal(funded.fundingIntervalApplied, false);
  assert.equal(opened.pnl, "29.59");
  assert.equal(opened.funding, "0");

  const closed = post(book, {
    accountId: "fixture-linear",
    idempotencyKey: "fixture-key-close",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "short",
    quantity: "2",
    feeRate: "0.001",
    bids: [{ price: "110", quantity: "2" }],
    asks: [],
    mark: "110",
    statement: statement("2", "10", "0.63", "-0.1", "29.27"),
  });
  paper(closed);
  assert.equal(closed.ok, true, closed.error);
  assert.equal(closed.state, "fill");
  assert.equal(closed.partial, false);
  assert.equal(closed.eventFee, "0.22");
  assert.equal(closed.fees, "0.63");
  assert.equal(closed.realizedPnl, "20");
  assert.equal(closed.positionValue, "10");
  assert.equal(closed.positionQuantity, "2");
  assert.equal(closed.funding, "-0.1");
  assert.equal(closed.pnl, "29.27");
  assert.deepEqual(closed.lots, [
    { side: "long", quantity: "1", entry: "100" },
    { side: "long", quantity: "1", entry: "110" },
  ]);
  const realized = convertContractPnl(book.contracts, {
    contractId: "fixture-linear-perpetual",
    side: "long",
    quantity: "2",
    entryPrice: "100",
    exitPrice: "110",
  });
  assert.equal(realized.pnl, "20");
  assert.equal(closed.realizedPnl, realized.pnl);
  const latest = readFuturesAccounting(book.accounting, {
    actor: ACTOR,
    accountId: "fixture-linear",
  });
  assert.equal(latest.idempotentReplay, false);
  assert.equal(latest.pnl, "29.27");
  assert.equal(latest.sequence, "3");
  assert.equal(opened.sequence, "1");
});

test("inverse contract units reconcile position value, fees, and pnl", () => {
  const book = stores();
  const inverse = post(book, {
    accountId: "fixture-inverse",
    idempotencyKey: "fixture-key-inverse",
    contractId: "fixture-inverse-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "2",
    feeRate: "0.001",
    bids: [],
    asks: [{ price: "100", quantity: "2" }],
    mark: "110",
    statement: statement("2", "1/550", "0.00002", "0", "989/550000"),
  });
  paper(inverse);
  assert.equal(inverse.ok, true, inverse.error);
  assert.equal(inverse.formula, INVERSE_PNL);
  assert.equal(inverse.notionalFormula, FUTURES_FILL_NOTIONAL_INVERSE);
  assert.equal(inverse.settlement, "BTC");
  assert.equal(inverse.quantityUnit, "contract");
  assert.equal(inverse.multiplier, "1");
  assert.equal(inverse.positionValue, "1/550");
  assert.equal(inverse.fees, "0.00002");
  assert.equal(inverse.funding, "0");
  assert.equal(inverse.pnl, "989/550000");
  const trading = convertContractPnl(book.contracts, {
    contractId: "fixture-inverse-perpetual",
    side: "long",
    quantity: "2",
    entryPrice: "100",
    exitPrice: "110",
  });
  assert.equal(trading.pnl, "1/550");
  assert.equal(inverse.positionValue, trading.pnl);

  const dated = post(book, {
    accountId: "fixture-inverse-dated",
    idempotencyKey: "fixture-key-dated",
    contractId: "fixture-inverse-dated",
    kind: "fill",
    direction: "long",
    quantity: "1",
    feeRate: "0.001",
    bids: [],
    asks: [{ price: "100", quantity: "1" }],
    mark: "125",
    statement: statement("1", "0.02", "0.0001", "0", "0.0199"),
  });
  paper(dated);
  assert.equal(dated.ok, true, dated.error);
  assert.equal(dated.multiplier, "10");
  assert.equal(dated.positionValue, "0.02");
  assert.equal(dated.fees, "0.0001");
  assert.equal(dated.pnl, "0.0199");
  assert.equal(dated.fundingInterval, null);
  assert.equal(dated.fundingIntervalApplied, false);
  const datedPnl = convertContractPnl(book.contracts, {
    contractId: "fixture-inverse-dated",
    side: "long",
    quantity: "1",
    entryPrice: "100",
    exitPrice: "125",
  });
  assert.equal(datedPnl.pnl, "0.02");
  assert.equal(dated.positionValue, datedPnl.pnl);
  assert.equal(inverse.pnl, "989/550000");
});

test("a mismatched statement stays visible and a spot order is not filled", () => {
  const book = stores();
  const mismatched = post(book, {
    accountId: "fixture-mismatch",
    idempotencyKey: "fixture-key-mismatch",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "2",
    feeRate: "0.001",
    bids: [],
    asks: [{ price: "100", quantity: "2" }],
    mark: "100",
    statement: statement("2", "0", "9.001", "0", "-0.2"),
  });
  paper(mismatched);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.blocked, "BLOCKED");
  assert.equal(mismatched.reconciled, false);
  assert.equal(mismatched.alert, true);
  assert.equal(mismatched.promoted, false);
  assert.equal(mismatched.error, "fees do not match");
  assert.equal(mismatched.fees, "0.2");
  assert.equal(mismatched.statement.fees, "9.001");
  assert.equal(mismatched.pnl, "-0.2");
  assert.equal(mismatched.positionQuantity, "2");
  const again = post(book, {
    accountId: "fixture-mismatch",
    idempotencyKey: "fixture-key-mismatch",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "2",
    feeRate: "0.001",
    bids: [],
    asks: [{ price: "100", quantity: "2" }],
    mark: "100",
    statement: statement("2", "0", "9.001", "0", "-0.2"),
  });
  assert.equal(again.idempotentReplay, true);
  assert.equal(again.positionQuantity, "2");
  assert.equal(again.sequence, "1");

  const spot = post(book, {
    accountId: "fixture-spot",
    idempotencyKey: "fixture-key-spot",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    product: "spot",
    order: { state: "create", orderId: "fixture-spot-order" },
  });
  assert.equal(spot.error, "product is not supported");
  assert.equal(spot.report, null);
  assert.equal(JSON.stringify(spot).includes("fixture-spot-order"), false);

  const secret = post(book, {
    accountId: "fixture-secret",
    idempotencyKey: "fixture-key-secret",
    contractId: "fixture-linear-perpetual",
    kind: "funding",
    amount: "bearer fixture-token",
    statement: statement("0", "0", "0", "0", "0"),
  });
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);

  const version = post(book, {
    accountId: "fixture-version",
    idempotencyKey: "fixture-key-version",
    contractId: "fixture-linear-perpetual",
    kind: "mark",
    assumptionsVersion: "guessed-version",
    mark: "100",
    statement: statement("0", "0", "0", "0", "0"),
  });
  assert.equal(version.error, "assumptions version does not match");
  assert.equal(JSON.stringify(version).includes("guessed-version"), false);

  const offTick = post(book, {
    accountId: "fixture-tick",
    idempotencyKey: "fixture-key-tick",
    contractId: "fixture-linear-perpetual",
    kind: "fill",
    direction: "long",
    quantity: "1",
    feeRate: "0.001",
    bids: [],
    asks: [{ price: "100.2", quantity: "1" }],
    mark: "100",
    statement: statement("0", "0", "0", "0", "0"),
  });
  assert.equal(offTick.error, "price is not on the tick");
  assert.equal(offTick.report, null);
  assert.equal(JSON.stringify(offTick).includes("100.2"), false);

  const customer = post(book, {
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
    accountId: "fixture-customer",
    idempotencyKey: "fixture-key-customer",
    contractId: "fixture-linear-perpetual",
    kind: "mark",
    mark: "100",
    statement: statement("0", "0", "0", "0", "0"),
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(customer.report, null);
  assert.equal(readFuturesAccounting(book.accounting, {
    actor: ACTOR,
    accountId: "fixture-tick",
  }).error, "account is not configured");

  const source = readFileSync(new URL("../services/futures-accounting.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("convertContractPnl"), true);
  assert.equal(source.includes("readSpotDepthView"), false);
  assert.equal(source.includes("appendFuturesPaperOrder"), false);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(Object.keys(accounting).sort(), [
    "FUTURES_ACCOUNTING_ASSUMPTIONS",
    "FUTURES_ACCOUNTING_LIMITATIONS",
    "FUTURES_ACCOUNTING_PNL",
    "FUTURES_ACCOUNTING_VERSION",
    "FUTURES_FILL_FEE",
    "FUTURES_FILL_NOTIONAL_INVERSE",
    "FUTURES_FILL_NOTIONAL_LINEAR",
    "createFuturesAccountingStore",
    "postFuturesAccounting",
    "readFuturesAccounting",
  ]);
  assert.deepEqual(health, {
    status: "ok",
    liveTrading: "OFF",
    liveOrdersLocked: true,
  });
});
