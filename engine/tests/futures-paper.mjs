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
import { POSITION_MODES } from "../services/derivatives-features.mjs";
import {
  FUTURES_MARGIN_MODES,
  FUTURES_PAPER_LIMITATIONS,
  FUTURES_PRODUCT,
  appendFuturesPaperOrder,
  createFuturesPaperStore,
  readFuturesPaperPosition,
} from "../services/futures-paper.mjs";
import * as futures from "../services/futures-paper.mjs";
import { appendPaperOrder, createPaperOrderStore } from "../services/paper-orders.mjs";

// Prices, quantities, and multipliers are the decision 0052 contract fixtures.
// Funding interval 8 is a fixture. This model does not apply it.
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
    id: "fixture-linear-dated",
    tenor: "dated",
    multiplier: "0.01",
    tickSize: "0.1",
    expiry: TIME,
    fundingInterval: null,
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
  return { contracts: contracts(), futures: createFuturesPaperStore() };
}

function order(extra = {}) {
  return {
    actor: { ...ACTOR },
    orderId: "fixture-futures-order",
    idempotencyKey: "fixture-key",
    contractId: "fixture-linear-perpetual",
    direction: "long",
    quantity: "2",
    price: "100",
    reduceOnly: false,
    positionMode: "one-way",
    marginMode: "isolated",
    product: "futures",
    ...extra,
  };
}

function paper(result) {
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.deepEqual(result.limitations, [...FUTURES_PAPER_LIMITATIONS]);
}

test("linear and inverse futures positions use the contract pnl", () => {
  const book = stores();
  const opened = appendFuturesPaperOrder(book, order());
  paper(opened);
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.product, FUTURES_PRODUCT);
  assert.equal(opened.pnl, null);
  assert.equal(opened.formula, LINEAR_PNL);
  assert.equal(opened.order.multiplier, "1");
  assert.equal(opened.order.closedQuantity, "0");
  assert.equal(opened.position.long.quantity, "2");
  assert.equal(opened.position.long.entry, "100");
  assert.equal(opened.position.short, null);
  const replay = appendFuturesPaperOrder(book, order());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.order, opened.order);
  assert.equal(book.futures.orders.size, 1);
  const first = appendFuturesPaperOrder(book, order({
    orderId: "fixture-close-1",
    idempotencyKey: "fixture-key-close-1",
    quantity: "1",
    price: "110",
    reduceOnly: true,
  }));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.pnl, "10");
  assert.equal(first.formula, LINEAR_PNL);
  assert.equal(first.position.long.quantity, "1");
  assert.equal(first.position.realizedPnl, "10");
  const second = appendFuturesPaperOrder(book, order({
    orderId: "fixture-close-2",
    idempotencyKey: "fixture-key-close-2",
    quantity: "1",
    price: "110",
    reduceOnly: true,
  }));
  assert.equal(second.ok, true, second.error);
  assert.equal(second.pnl, "10");
  assert.equal(second.position.long, null);
  assert.equal(second.position.realizedPnl, "20");
  assert.equal(second.pnl, convertContractPnl(book.contracts, {
    contractId: "fixture-linear-perpetual",
    side: "long",
    quantity: "1",
    entryPrice: "100",
    exitPrice: "110",
  }).pnl);
  const read = readFuturesPaperPosition(book.futures, {
    actor: { ...ACTOR },
    contractId: "fixture-linear-perpetual",
  });
  assert.equal(read.position.realizedPnl, "20");
  assert.equal(read.position.multiplier, "1");

  const inverse = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-open",
    idempotencyKey: "fixture-key-inverse-open",
    contractId: "fixture-inverse-perpetual",
    marginMode: "cross",
  }));
  assert.equal(inverse.ok, true, inverse.error);
  assert.equal(inverse.formula, INVERSE_PNL);
  assert.equal(inverse.order.multiplier, "1");
  const inverseClose = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-close",
    idempotencyKey: "fixture-key-inverse-close",
    contractId: "fixture-inverse-perpetual",
    price: "110",
    reduceOnly: true,
    marginMode: "cross",
  }));
  assert.equal(inverseClose.ok, true, inverseClose.error);
  assert.equal(inverseClose.pnl, "1/550");
  assert.equal(inverseClose.formula, INVERSE_PNL);
  const inverseShort = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-short",
    idempotencyKey: "fixture-key-inverse-short",
    contractId: "fixture-inverse-perpetual",
    direction: "short",
    marginMode: "cross",
  }));
  const inverseShortClose = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-short-close",
    idempotencyKey: "fixture-key-inverse-short-close",
    contractId: "fixture-inverse-perpetual",
    direction: "short",
    price: "110",
    reduceOnly: true,
    marginMode: "cross",
  }));
  assert.equal(inverseShort.ok, true, inverseShort.error);
  assert.equal(inverseShortClose.pnl, "-1/550");

  const dated = appendFuturesPaperOrder(book, order({
    orderId: "fixture-dated-open",
    idempotencyKey: "fixture-key-dated-open",
    contractId: "fixture-linear-dated",
    direction: "short",
  }));
  const datedClose = appendFuturesPaperOrder(book, order({
    orderId: "fixture-dated-close",
    idempotencyKey: "fixture-key-dated-close",
    contractId: "fixture-linear-dated",
    direction: "short",
    price: "110",
    reduceOnly: true,
  }));
  assert.equal(dated.ok, true, dated.error);
  assert.equal(dated.order.multiplier, "0.01");
  assert.equal(datedClose.pnl, "-0.2");
  assert.equal(datedClose.formula, LINEAR_PNL);

  const inverseDated = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-dated-open",
    idempotencyKey: "fixture-key-inverse-dated-open",
    contractId: "fixture-inverse-dated",
    quantity: "1",
    marginMode: "cross",
  }));
  const inverseDatedClose = appendFuturesPaperOrder(book, order({
    orderId: "fixture-inverse-dated-close",
    idempotencyKey: "fixture-key-inverse-dated-close",
    contractId: "fixture-inverse-dated",
    quantity: "1",
    price: "125",
    reduceOnly: true,
    marginMode: "cross",
  }));
  assert.equal(inverseDated.ok, true, inverseDated.error);
  assert.equal(inverseDated.order.multiplier, "10");
  assert.equal(inverseDatedClose.pnl, "0.02");
  assert.equal(inverseDatedClose.formula, INVERSE_PNL);
  assert.equal(Object.isFrozen(inverseDatedClose), true);
});

test("reduce-only, hedge, and one-way keep the open side", () => {
  const book = stores();
  const long = appendFuturesPaperOrder(book, order({ positionMode: "hedge", marginMode: "cross" }));
  const short = appendFuturesPaperOrder(book, order({
    orderId: "fixture-hedge-short",
    idempotencyKey: "fixture-key-hedge-short",
    direction: "short",
    positionMode: "hedge",
    marginMode: "cross",
  }));
  assert.equal(long.ok, true, long.error);
  assert.equal(short.ok, true, short.error);
  assert.equal(short.position.long.quantity, "2");
  assert.equal(short.position.short.quantity, "2");
  const reduced = appendFuturesPaperOrder(book, order({
    orderId: "fixture-hedge-reduce",
    idempotencyKey: "fixture-key-hedge-reduce",
    price: "110",
    reduceOnly: true,
    positionMode: "hedge",
    marginMode: "cross",
  }));
  assert.equal(reduced.ok, true, reduced.error);
  assert.equal(reduced.pnl, "20");
  assert.equal(reduced.position.long, null);
  assert.equal(reduced.position.short.quantity, "2");
  const wrongMode = appendFuturesPaperOrder(book, order({
    orderId: "fixture-mode",
    idempotencyKey: "fixture-key-mode",
    direction: "short",
    positionMode: "one-way",
    marginMode: "cross",
  }));
  assert.equal(wrongMode.error, "position mode does not match");
  assert.equal(book.futures.orders.size, 3);
  const wrongMargin = appendFuturesPaperOrder(book, order({
    orderId: "fixture-margin",
    idempotencyKey: "fixture-key-margin",
    direction: "short",
    positionMode: "hedge",
    marginMode: "isolated",
  }));
  assert.equal(wrongMargin.error, "margin mode does not match");
  assert.equal(reduced.position.short.quantity, "2");

  const oneWay = stores();
  assert.equal(appendFuturesPaperOrder(oneWay, order()).ok, true);
  const opposite = appendFuturesPaperOrder(oneWay, order({
    orderId: "fixture-opposite",
    idempotencyKey: "fixture-key-opposite",
    direction: "short",
    reduceOnly: true,
  }));
  assert.equal(opposite.error, "reduce-only side does not match");
  assert.equal(readFuturesPaperPosition(oneWay.futures, {
    actor: { ...ACTOR },
    contractId: "fixture-linear-perpetual",
  }).position.long.quantity, "2");
  const flip = appendFuturesPaperOrder(oneWay, order({
    orderId: "fixture-flip",
    idempotencyKey: "fixture-key-flip",
    direction: "short",
    quantity: "3",
    price: "110",
    reduceOnly: false,
  }));
  assert.equal(flip.ok, true, flip.error);
  assert.equal(flip.pnl, "20");
  assert.equal(flip.order.closedQuantity, "2");
  assert.equal(flip.position.long, null);
  assert.equal(flip.position.short.quantity, "1");
  assert.equal(flip.position.short.entry, "110");
  const larger = appendFuturesPaperOrder(oneWay, order({
    orderId: "fixture-larger",
    idempotencyKey: "fixture-key-larger",
    direction: "short",
    quantity: "2",
    price: "110",
    reduceOnly: true,
  }));
  assert.equal(larger.error, "reduce-only quantity is larger than the position");
  assert.equal(oneWay.futures.positions.get("fixture-tenant\u0000fixture-linear-perpetual").short.quantity, "1");
  const empty = stores();
  const blocked = appendFuturesPaperOrder(empty, order({ reduceOnly: true }));
  assert.equal(blocked.error, "reduce-only has no position");
  assert.equal(empty.futures.orders.size, 0);
  const otherEntry = appendFuturesPaperOrder(oneWay, order({
    orderId: "fixture-entry",
    idempotencyKey: "fixture-key-entry",
    direction: "short",
    price: "111",
    reduceOnly: false,
  }));
  assert.equal(otherEntry.error, "entry price is already recorded");
  assert.equal(oneWay.futures.positions.get("fixture-tenant\u0000fixture-linear-perpetual").short.quantity, "1");
});

test("a spot order object is not a futures order", () => {
  const book = stores();
  const spot = appendFuturesPaperOrder(book, {
    actor: { ...ACTOR },
    orderId: "fixture-spot-order",
    idempotencyKey: "fixture-key-spot",
    state: "create",
    product: "spot",
  });
  paper(spot);
  assert.equal(spot.ok, false);
  assert.equal(spot.blocked, "BLOCKED");
  assert.equal(spot.error, "product is not supported");
  assert.equal(spot.order, null);
  assert.equal(spot.product, null);
  assert.equal(book.futures.orders.size, 0);
  assert.equal(JSON.stringify(spot).includes("fixture-spot-order"), false);
  const namedSpot = appendFuturesPaperOrder(book, order({ product: "spot", orderId: "fixture-spot-order" }));
  assert.equal(namedSpot.error, "product is not supported");
  assert.equal(book.futures.orders.size, 0);
  const spotBook = createPaperOrderStore();
  const rejected = appendPaperOrder(spotBook, {
    actor: { ...ACTOR },
    orderId: "fixture-futures-order",
    idempotencyKey: "fixture-key",
    state: "create",
    product: "futures",
  });
  assert.equal(rejected.error, "product is not supported");
  assert.equal(JSON.stringify(rejected).includes("fixture-futures-order"), false);
  assert.equal(spotBook.orders.size, 0);
  const denied = appendFuturesPaperOrder(book, order({
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
  }));
  paper(denied);
  assert.equal(denied.error, "role scope denied");
  assert.equal(book.futures.orders.size, 0);
  const secret = appendFuturesPaperOrder(book, order({ orderId: "bearer fixture-token" }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  const offTick = appendFuturesPaperOrder(book, order({ price: "100.2" }));
  assert.equal(offTick.error, "price is not on the tick");
  assert.equal(JSON.stringify(offTick).includes("100.2"), false);
  assert.equal(book.futures.orders.size, 0);
  assert.deepEqual(FUTURES_MARGIN_MODES, ["isolated", "cross"]);
  assert.deepEqual(POSITION_MODES, ["hedge", "one-way"]);
  assert.deepEqual(Object.keys(futures).sort(), [
    "FUTURES_MARGIN_MODES",
    "FUTURES_PAPER_LIMITATIONS",
    "FUTURES_PRODUCT",
    "appendFuturesPaperOrder",
    "createFuturesPaperStore",
    "readFuturesPaperPosition",
  ]);
  const source = readFileSync(new URL("../services/futures-paper.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("convertContractPnl"), true);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
