import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { SPOT_STREAM_LIFECYCLE } from "../services/binance-spot-public.mjs";
import { PAPER_QUEUE_ASSUMPTIONS, estimatePaperQueue } from "../services/paper-queue.mjs";
import * as queue from "../services/paper-queue.mjs";
import { createSpotBookSync } from "../services/spot-book-sync.mjs";

// Prices extend the decision 0034 book. They are not a live quote.
// Fee rate 0.001 and latency 0 and 5 are caller fixtures.
// The public trade clock is milliseconds by default. The design names no latency number.
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

function trade(id, price, qty, time, buyerIsMaker, extra = {}) {
  return {
    e: "trade",
    E: extra.E ?? time,
    s: extra.s ?? "BNBBTC",
    t: id,
    p: price,
    q: qty,
    T: time,
    m: buyerIsMaker,
    M: extra.M ?? true,
  };
}

function request(status, extra = {}) {
  return {
    status,
    levels: 10,
    symbol: "BNBBTC",
    side: "buy",
    price: "0.0025",
    quantity: "2",
    feeRate: "0.001",
    placedAt: TIME,
    latency: "0",
    trades: [],
    ...extra,
  };
}

function labeled(result) {
  assert.equal(result.estimate, true);
  assert.deepEqual(result.assumptions, [...PAPER_QUEUE_ASSUMPTIONS]);
  assert.equal(result.assumptions.includes("simulated fill is an estimate"), true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.latencyApplied, false);
}

test("passive volume behind the visible queue is a partial estimate", () => {
  const { opened } = openedBook();
  const aheadOnly = estimatePaperQueue(request(opened, {
    trades: [trade(1, "0.0025", "3", TIME + 1, true)],
  }));
  labeled(aheadOnly);
  assert.equal(aheadOnly.ok, true, aheadOnly.error);
  assert.equal(aheadOnly.queueAhead, "3");
  assert.equal(aheadOnly.filledQuantity, "0");
  assert.equal(aheadOnly.unfilledQuantity, "2");
  assert.equal(aheadOnly.state, null);
  assert.equal(aheadOnly.partial, false);
  assert.equal(aheadOnly.fee, "0");
  assert.equal(aheadOnly.notional, "0");
  assert.equal(aheadOnly.averagePrice, null);
  assert.equal(aheadOnly.spread, "0.0001");
  const partial = estimatePaperQueue(request(opened, {
    trades: [
      trade(3, "0.0025", "2", TIME + 4, true),
      trade(2, "0.0025", "2", TIME + 2, true),
    ],
  }));
  labeled(partial);
  assert.equal(partial.ok, true, partial.error);
  assert.equal(partial.state, "partial fill");
  assert.equal(partial.partial, true);
  assert.equal(partial.queueAhead, "3");
  assert.equal(partial.filledQuantity, "1");
  assert.equal(partial.unfilledQuantity, "1");
  assert.equal(partial.averagePrice, "0.0025");
  assert.equal(partial.notional, "0.0025");
  assert.equal(partial.fee, "0.0000025");
  assert.equal(partial.liveAt, String(TIME));
  assert.equal(partial.cancelled, false);
  const full = estimatePaperQueue(request(opened, {
    trades: [trade(4, "0.0025", "5", TIME + 2, true)],
  }));
  assert.equal(full.state, "fill");
  assert.equal(full.filledQuantity, "2");
  assert.equal(full.unfilledQuantity, "0");
  assert.equal(full.notional, "0.005");
  assert.equal(full.fee, "0.000005");
  const ignored = estimatePaperQueue(request(opened, {
    trades: [
      trade(5, "0.0025", "4", TIME + 2, false),
      trade(6, "9.001", "100", TIME + 2, true),
      trade(7, "0.0024", "10", TIME + 2, true),
      trade(8, "0.0025", "4", TIME, true),
      trade(9, "0.0025", "4", TIME + 2, true, { E: TIME, M: false }),
      trade(9, "0.0025", "4", TIME + 3, true),
    ],
  }));
  labeled(ignored);
  assert.equal(ignored.filledQuantity, "1");
  assert.equal(ignored.queueAhead, "3");
  assert.equal(JSON.stringify(ignored).includes("9.001"), false);
  const delayed = estimatePaperQueue(request(opened, {
    latency: "5",
    trades: [trade(10, "0.0025", "4", TIME + 5, true)],
  }));
  labeled(delayed);
  assert.equal(delayed.liveAt, String(TIME + 5));
  assert.equal(delayed.filledQuantity, "0");
  assert.equal(delayed.latency, "5");
  const afterLive = estimatePaperQueue(request(opened, {
    latency: "5",
    trades: [trade(11, "0.0025", "4", TIME + 6, true, { E: TIME })],
  }));
  assert.equal(afterLive.filledQuantity, "1");
  assert.equal(afterLive.fee, partial.fee);
  const rested = estimatePaperQueue(request(opened, {
    price: "0.00255",
    quantity: "1",
    trades: [trade(12, "0.00255", "1", TIME + 1, true)],
  }));
  assert.equal(rested.ok, true, rested.error);
  assert.equal(rested.queueAhead, "0");
  assert.equal(rested.filledQuantity, "1");
  assert.equal(rested.state, "fill");
  const sell = estimatePaperQueue(request(opened, {
    side: "sell",
    price: "0.0026",
    quantity: "2",
    trades: [trade(13, "0.0026", "4", TIME + 1, false)],
  }));
  labeled(sell);
  assert.equal(sell.queueAhead, "3");
  assert.equal(sell.filledQuantity, "1");
  assert.equal(sell.state, "partial fill");
  assert.equal(sell.notional, "0.0026");
  assert.equal(sell.fee, "0.0000026");
  const makerBuyOnAsk = estimatePaperQueue(request(opened, {
    side: "sell",
    price: "0.0026",
    trades: [trade(14, "0.0026", "9", TIME + 1, true)],
  }));
  assert.equal(makerBuyOnAsk.filledQuantity, "0");
  const free = estimatePaperQueue(request(opened, {
    feeRate: "0",
    trades: [trade(15, "0.0025", "5", TIME + 1, true)],
  }));
  assert.equal(free.fee, "0");
  assert.equal(free.state, "fill");
  assert.equal(Object.isFrozen(partial), true);
  assert.throws(() => {
    partial.assumptions.push("guessed");
  }, TypeError);
});

test("cancellation and a non-passive or stale book produce no extra fill", () => {
  const { sync, opened } = openedBook();
  const cancelled = estimatePaperQueue(request(opened, {
    cancelledAt: TIME + 1,
    trades: [trade(21, "0.0025", "5", TIME + 2, true)],
  }));
  labeled(cancelled);
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.state, "cancel");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.filledQuantity, "0");
  assert.equal(cancelled.unfilledQuantity, "2");
  assert.equal(cancelled.fee, "0");
  assert.equal(cancelled.partial, false);
  const partialCancel = estimatePaperQueue(request(opened, {
    cancelledAt: TIME + 3,
    trades: [
      trade(22, "0.0025", "4", TIME + 2, true),
      trade(23, "0.0025", "4", TIME + 4, true),
    ],
  }));
  labeled(partialCancel);
  assert.equal(partialCancel.state, "cancel");
  assert.equal(partialCancel.partial, true);
  assert.equal(partialCancel.cancelled, true);
  assert.equal(partialCancel.filledQuantity, "1");
  assert.equal(partialCancel.unfilledQuantity, "1");
  assert.equal(partialCancel.fee, "0.0000025");
  const sameTime = estimatePaperQueue(request(opened, {
    cancelledAt: TIME + 2,
    trades: [trade(24, "0.0025", "5", TIME + 2, true)],
  }));
  assert.equal(sameTime.state, "cancel");
  assert.equal(sameTime.filledQuantity, "0");
  const crossing = estimatePaperQueue(request(opened, { price: "0.0026" }));
  labeled(crossing);
  assert.equal(crossing.ok, false);
  assert.equal(crossing.error, "order is not passive");
  assert.equal(crossing.filledQuantity, null);
  assert.equal(crossing.price, null);
  assert.equal(JSON.stringify(crossing).includes("0.0026"), false);
  assert.equal(sync.notePing(0).healthy, true);
  const stale = sync.status(SPOT_STREAM_LIFECYCLE.pongDeadlineMs);
  const hidden = estimatePaperQueue(request(stale, {
    trades: [trade(25, "0.0025", "9", TIME + 2, true)],
  }));
  labeled(hidden);
  assert.equal(hidden.error, "stale stream");
  assert.equal(hidden.filledQuantity, null);
  assert.equal(hidden.queueAhead, null);
  assert.equal(JSON.stringify(hidden).includes("0.0025"), false);
  const traded = estimatePaperQueue(request(opened, { lastPrice: "0.001" }));
  labeled(traded);
  assert.equal(traded.error, "last price is not a fill");
  assert.equal(JSON.stringify(traded).includes("0.001"), false);
  const missingLatency = estimatePaperQueue(request(opened, { latency: "" }));
  labeled(missingLatency);
  assert.equal(missingLatency.error, "latency is not configured");
  assert.equal(missingLatency.filledQuantity, null);
  const secret = estimatePaperQueue(request(opened, { symbol: "bearer fixture-token" }));
  labeled(secret);
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  const badTrade = estimatePaperQueue(request(opened, {
    trades: [{ e: "trade", p: "0.0025", q: "9" }],
  }));
  labeled(badTrade);
  assert.equal(badTrade.error, "trade schema is not allowed");
  assert.equal(badTrade.filledQuantity, null);
  assert.equal(JSON.stringify(badTrade).includes("0.0025"), false);
});

test("the passive queue does not submit a live order", () => {
  assert.deepEqual(Object.keys(queue).sort(), [
    "PAPER_QUEUE_ASSUMPTIONS",
    "estimatePaperQueue",
  ]);
  const source = readFileSync(new URL("../services/paper-queue.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readSpotDepthView"), true);
  assert.equal(source.includes("parseSpotStreamMessage"), true);
  assert.equal(source.includes("estimate"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
