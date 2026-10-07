import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as traderInput from "../packages/contracts/src/trader-input.mjs";
import { readTraderInput, TRADER_INPUT_VIEW_KEYS } from "../packages/contracts/src/trader-input.mjs";

// Official Spot bookTicker example. These strings are not a live quote.
// eventAge 0 is caller-supplied. The bookTicker example has no event timestamp.
// The source names no maximum event age.
const book = {
  bidPrice: "25.35190000",
  bidQty: "31.21000000",
  askPrice: "25.36520000",
  askQty: "40.66000000",
};

function input(overrides = {}) {
  return {
    venue: "Binance",
    symbol: "BNBUSDT",
    product: "Spot",
    expectedProduct: "Spot",
    bbo: { ...book },
    eventAge: 0,
    quality: { healthy: true, reason: null },
    sequence: 400900217,
    sequenceWatermark: null,
    ...overrides,
  };
}

function rejected(result) {
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "BLOCKED");
  assert.equal(Object.hasOwn(result, "view"), false);
}

test("a complete Spot book ticker becomes a frozen read-only view", () => {
  const opened = readTraderInput(input());
  assert.equal(opened.ok, true);
  assert.equal(opened.blocked, null);
  assert.deepEqual(Object.keys(opened.view), [...TRADER_INPUT_VIEW_KEYS]);
  assert.equal(opened.view.venue, "Binance");
  assert.equal(opened.view.symbol, "BNBUSDT");
  assert.equal(opened.view.product, "Spot");
  assert.deepEqual(opened.view.bbo, book);
  assert.equal(opened.view.eventAge, 0);
  assert.deepEqual(opened.view.quality, { healthy: true, reason: null });
  assert.equal(opened.view.sequenceWatermark, 400900217);
  assert.equal(Object.hasOwn(opened.view, "expectedProduct"), false);
  assert.equal(typeof opened.view.placeOrder, "undefined");
  assert.equal(Object.isFrozen(opened.view), true);
  assert.equal(Object.isFrozen(opened.view.bbo), true);
  assert.equal(Object.isFrozen(opened.view.quality), true);
  assert.throws(() => {
    opened.view.bbo.bidPrice = "0";
  }, TypeError);

  const aged = readTraderInput(input({ eventAge: 999999999, sequence: 400900218, sequenceWatermark: 400900217 }));
  assert.equal(aged.ok, true);
  assert.equal(aged.view.eventAge, 999999999);
  assert.equal(aged.view.sequenceWatermark, 400900218);

  const wide = readTraderInput(input({
    sequence: "9007199254740993",
    sequenceWatermark: "9007199254740992",
  }));
  assert.equal(wide.ok, true);
  assert.equal(wide.view.sequenceWatermark, "9007199254740993");
  assert.equal(typeof wide.view.sequenceWatermark, "string");
});

test("incomplete input and an order key return no view", () => {
  rejected(readTraderInput(input({ bbo: undefined })));
  assert.equal(readTraderInput(input({ bbo: undefined })).error, "trader input is incomplete");
  const numericBid = input();
  numericBid.bbo.bidPrice = 25.3519;
  rejected(readTraderInput(numericBid));
  assert.equal(readTraderInput(numericBid).error, "trader input is incomplete");
  rejected(readTraderInput(input({ sequence: undefined })));
  rejected(readTraderInput(input({ venue: "" })));
  rejected(readTraderInput(input({ eventAge: 1.5 })));
  const lastTrade = input();
  lastTrade.bbo.price = "0.001";
  lastTrade.bbo.quantity = "100";
  rejected(readTraderInput(lastTrade));
  assert.equal(readTraderInput(lastTrade).error, "trader input is incomplete");
  const order = input({ order: { side: "BUY" } });
  rejected(readTraderInput(order));
  assert.equal(readTraderInput(order).error, "trader input is incomplete");
});

test("stale quality, negative age, and an old watermark return no view", () => {
  const staleStream = readTraderInput(input({ quality: { healthy: false, reason: "stale stream" } }));
  rejected(staleStream);
  assert.equal(staleStream.error, "trader input is stale");
  const degraded = readTraderInput(input({ quality: "degraded" }));
  rejected(degraded);
  assert.equal(degraded.error, "trader input is stale");
  const skew = readTraderInput(input({ eventAge: -1 }));
  rejected(skew);
  assert.equal(skew.error, "trader input is stale");
  const same = readTraderInput(input({ sequenceWatermark: 400900217 }));
  rejected(same);
  assert.equal(same.error, "trader input is stale");
  const behind = readTraderInput(input({ sequence: 400900216, sequenceWatermark: 400900217 }));
  rejected(behind);
  assert.equal(behind.error, "trader input is stale");
  const wideBehind = readTraderInput(input({
    sequence: "9007199254740992",
    sequenceWatermark: "9007199254740993",
  }));
  rejected(wideBehind);
  assert.equal(wideBehind.error, "trader input is stale");
});

test("a different product returns no view", () => {
  const wrong = readTraderInput(input({ product: "USD-M" }));
  rejected(wrong);
  assert.equal(wrong.error, "product is not allowed");
});

test("the contract exports no order placement and live orders stay locked", () => {
  assert.equal(traderInput.placeOrder, undefined);
  assert.equal(traderInput.order, undefined);
  assert.equal(traderInput.submit, undefined);
  assert.equal(traderInput.side, undefined);
  assert.deepEqual(Object.keys(traderInput).sort(), ["TRADER_INPUT_VIEW_KEYS", "readTraderInput"]);
  assert.equal(TRADER_INPUT_VIEW_KEYS.includes("order"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
