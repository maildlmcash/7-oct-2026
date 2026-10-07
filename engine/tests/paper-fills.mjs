import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { SPOT_STREAM_LIFECYCLE } from "../services/binance-spot-public.mjs";
import { readExecutionCost } from "../services/execution-costs.mjs";
import { PAPER_FILL_LIMITATIONS, simulatePaperFill } from "../services/paper-fills.mjs";
import * as fills from "../services/paper-fills.mjs";
import { createSpotBookSync } from "../services/spot-book-sync.mjs";
import { readSpotDepthView } from "../services/spot-depth-view.mjs";

// Prices extend the decision 0034 book. They are not a live quote.
// Fee rate 0.001 and latency 0 and 5 are caller fixtures.
// The source names no fee tier, no latency model, and no latency unit.
const TIME = 1672515782136;

function depth(U, u, bids, asks, E = TIME) {
  return { e: "depthUpdate", E, s: "BNBBTC", U, u, b: bids, a: asks };
}

function openedBook() {
  const sync = createSpotBookSync("BNBBTC");
  const event = depth(157, 160, [
    ["0.0024", "1"],
    ["0.0025", "3"],
  ], [
    ["0.0027", "1"],
    ["0.0026", "3"],
  ]);
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(event, event.E).book, null);
  const opened = sync.ingestSnapshot({
    lastUpdateId: event.U,
    bids: [["0.0024", "1"]],
    asks: [["0.0026", "1"]],
  });
  assert.equal(opened.healthy, true);
  return { sync, opened };
}

function request(status, extra = {}) {
  return {
    status,
    levels: 10,
    side: "buy",
    quantity: "4",
    feeRate: "0.001",
    latency: "0",
    ...extra,
  };
}

test("a marketable paper fill consumes the visible levels", () => {
  const { opened } = openedBook();
  const view = readSpotDepthView(opened, { levels: 10 });
  assert.equal(view.executable, true);
  assert.equal(view.spread, "0.0001");
  const bought = simulatePaperFill(request(opened));
  assert.equal(bought.ok, true, bought.error);
  assert.equal(bought.state, "fill");
  assert.equal(bought.partial, false);
  assert.equal(bought.side, "buy");
  assert.equal(bought.spread, "0.0001");
  assert.deepEqual(bought.levels, [
    { price: "0.0026", quantity: "3", remaining: "0" },
    { price: "0.0027", quantity: "1", remaining: "0" },
  ]);
  assert.equal(bought.filledQuantity, "4");
  assert.equal(bought.unfilledQuantity, "0");
  assert.equal(bought.averagePrice, "0.002625");
  assert.equal(bought.notional, "0.0105");
  assert.equal(bought.fee, "0.0000105");
  assert.equal(bought.feeRate, "0.001");
  assert.equal(bought.latency, "0");
  assert.equal(bought.latencyApplied, false);
  assert.equal(bought.validityTimestamp, TIME);
  assert.equal(bought.liveTrading, "OFF");
  assert.equal(bought.liveOrdersLocked, true);
  assert.equal(bought.liveOrderSubmitted, false);
  assert.equal(bought.venueClient, null);
  assert.equal(bought.mode, "paper");
  assert.equal(bought.product, "spot");
  assert.deepEqual(bought.limitations, [...PAPER_FILL_LIMITATIONS]);
  const roundTrip = readExecutionCost({
    bids: view.bids,
    asks: view.asks,
    quantity: "4",
    feeRate: "0.001",
  });
  assert.equal(roundTrip.ok, true, roundTrip.error);
  assert.equal(bought.averagePrice, roundTrip.averageBuy);
  assert.equal(bought.fee === roundTrip.feeReturn, false);
  const touch = simulatePaperFill(request(opened, { quantity: "3" }));
  assert.equal(touch.state, "fill");
  assert.deepEqual(touch.levels, [
    { price: "0.0026", quantity: "3", remaining: "0" },
  ]);
  assert.equal(touch.averagePrice, "0.0026");
  assert.equal(touch.notional, "0.0078");
  assert.equal(touch.fee, "0.0000078");
  const inside = simulatePaperFill(request(opened, { quantity: "2" }));
  assert.deepEqual(inside.levels, [
    { price: "0.0026", quantity: "2", remaining: "1" },
  ]);
  assert.equal(inside.filledQuantity, "2");
  assert.equal(inside.unfilledQuantity, "0");
  const fraction = simulatePaperFill(request(opened, { quantity: "3.5" }));
  assert.equal(fraction.state, "fill");
  assert.deepEqual(fraction.levels, [
    { price: "0.0026", quantity: "3", remaining: "0" },
    { price: "0.0027", quantity: "0.5", remaining: "0.5" },
  ]);
  assert.equal(fraction.filledQuantity, "3.5");
  assert.equal(fraction.averagePrice, "183/70000");
  assert.equal(fraction.notional, "0.00915");
  assert.equal(fraction.fee, "0.00000915");
  const sold = simulatePaperFill(request(opened, { side: "sell", quantity: "4" }));
  assert.equal(sold.state, "fill");
  assert.deepEqual(sold.levels, [
    { price: "0.0025", quantity: "3", remaining: "0" },
    { price: "0.0024", quantity: "1", remaining: "0" },
  ]);
  assert.equal(sold.averagePrice, "0.002475");
  assert.equal(sold.averagePrice, roundTrip.averageSell);
  assert.equal(sold.notional, "0.0099");
  assert.equal(sold.fee, "0.0000099");
  assert.equal(sold.spread, view.spread);
  const short = simulatePaperFill(request(opened, { quantity: "5" }));
  assert.equal(short.ok, true, short.error);
  assert.equal(short.state, "partial fill");
  assert.equal(short.partial, true);
  assert.equal(short.filledQuantity, "4");
  assert.equal(short.unfilledQuantity, "1");
  assert.deepEqual(short.levels, bought.levels);
  assert.equal(short.averagePrice, "0.002625");
  const refused = readExecutionCost({
    bids: view.bids,
    asks: view.asks,
    quantity: "5",
    feeRate: "0.001",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "depth is not sufficient");
  const later = simulatePaperFill(request(opened, { latency: "5" }));
  assert.equal(later.latency, "5");
  assert.equal(later.latencyApplied, false);
  assert.deepEqual(later.levels, bought.levels);
  assert.equal(later.averagePrice, bought.averagePrice);
  assert.equal(later.fee, bought.fee);
  const free = simulatePaperFill(request(opened, { feeRate: "0", quantity: "3" }));
  assert.equal(free.fee, "0");
  assert.equal(free.averagePrice, "0.0026");
  const duplicate = simulatePaperFill({
    status: {
      healthy: true,
      book: {
        validityTimestamp: TIME,
        bids: [["0.0025", "3"]],
        asks: [["0.0026", "1"], ["0.0026", "2"]],
      },
    },
    levels: 10,
    side: "buy",
    quantity: "3",
    feeRate: "0.001",
    latency: "0",
  });
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.deepEqual(duplicate.levels, [
    { price: "0.0026", quantity: "3", remaining: "0" },
  ]);
  assert.equal(Object.isFrozen(bought), true);
  assert.throws(() => {
    bought.levels[0].quantity = "9";
  }, TypeError);
  assert.equal(bought.levels[0].quantity, "3");
});

test("an invalid or stale book produces no paper fill", () => {
  const { sync, opened } = openedBook();
  assert.equal(sync.notePing(0).healthy, true);
  const stale = sync.status(SPOT_STREAM_LIFECYCLE.pongDeadlineMs);
  assert.equal(stale.reason, "stale stream");
  const hidden = simulatePaperFill(request(stale));
  assert.equal(hidden.ok, false);
  assert.equal(hidden.blocked, "BLOCKED");
  assert.equal(hidden.error, "stale stream");
  assert.equal(hidden.state, null);
  assert.equal(hidden.filledQuantity, null);
  assert.equal(hidden.levels, null);
  assert.equal(hidden.spread, null);
  assert.equal(hidden.averagePrice, null);
  assert.equal(hidden.fee, null);
  assert.equal(hidden.liveOrderSubmitted, false);
  assert.equal(hidden.venueClient, null);
  assert.equal(JSON.stringify(hidden).includes("0.0026"), false);
  const gappedBook = openedBook();
  const gap = gappedBook.sync.ingestDepth(depth(162, 163, [], [["0.0026", "9"]]), TIME);
  assert.equal(gap.reason, "sequence gap");
  const gapped = simulatePaperFill(request(gap, { quantity: "1" }));
  assert.equal(gapped.error, "sequence gap");
  assert.equal(gapped.filledQuantity, null);
  assert.equal(JSON.stringify(gapped).includes("0.0026"), false);
  const traded = simulatePaperFill(request(opened, { lastPrice: "0.001" }));
  assert.equal(traded.error, "last price is not a fill");
  assert.equal(traded.filledQuantity, null);
  assert.equal(traded.levels, null);
  assert.equal(JSON.stringify(traded).includes("0.001"), false);
  const alone = simulatePaperFill({
    status: { healthy: false, reason: "book is not valid" },
    levels: 10,
    side: "buy",
    quantity: "1",
    feeRate: "0.001",
    latency: "0",
    lastPrice: "0.001",
  });
  assert.equal(alone.error, "last price is not a fill");
  assert.equal(JSON.stringify(alone).includes("0.001"), false);
  const missingLatency = simulatePaperFill(request(opened, { latency: "" }));
  assert.equal(missingLatency.error, "latency is not configured");
  assert.equal(missingLatency.filledQuantity, null);
  const badLatency = simulatePaperFill(request(opened, { latency: "5ms" }));
  assert.equal(badLatency.error, "unsupported field");
  assert.equal(JSON.stringify(badLatency).includes("5ms"), false);
  const crossed = simulatePaperFill({
    status: {
      healthy: true,
      book: {
        validityTimestamp: TIME,
        bids: [["0.0026", "1"]],
        asks: [["0.0025", "1"]],
      },
    },
    levels: 10,
    side: "sell",
    quantity: "1",
    feeRate: "0.001",
    latency: "0",
  });
  assert.equal(crossed.error, "book is not valid");
  assert.equal(crossed.filledQuantity, null);
  assert.equal(JSON.stringify(crossed).includes("0.0026"), false);
  const bound = simulatePaperFill(request(opened, { levels: 5 }));
  assert.equal(bound.error, "depth bound is not configured");
  assert.equal(bound.filledQuantity, null);
  const secret = simulatePaperFill(request(opened, { side: "bearer fixture-token" }));
  assert.equal(secret.error, "unsupported field");
  assert.equal(secret.filledQuantity, null);
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
});

test("the paper fill does not submit a live order", () => {
  assert.deepEqual(Object.keys(fills).sort(), [
    "PAPER_FILL_LIMITATIONS",
    "simulatePaperFill",
  ]);
  const source = readFileSync(new URL("../services/paper-fills.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readSpotDepthView"), true);
  assert.equal(source.includes("readExecutionCost"), false);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
