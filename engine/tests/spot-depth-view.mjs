import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { SPOT_STREAM_LIFECYCLE } from "../services/binance-spot-public.mjs";
import { createSpotBookSync } from "../services/spot-book-sync.mjs";
import { DEPTH_LEVEL_BOUNDS, readSpotDepthView } from "../services/spot-depth-view.mjs";

// Prices extend the official diff-depth example. They are not a live quote.
const firstTime = 1672515782136;
const nextTime = 1672515782137;

function depth(U, u, bids, asks, E = firstTime) {
  return { e: "depthUpdate", E, s: "BNBBTC", U, u, b: bids, a: asks };
}

function bridge(sync, event) {
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(event, event.E).book, null);
  return sync.ingestSnapshot({
    lastUpdateId: event.U,
    bids: [["0.0024", "1"]],
    asks: [["0.0026", "1"]],
  });
}

test("a healthy book exposes ordered depth, totals, spread, and imbalance", () => {
  const sync = createSpotBookSync("BNBBTC");
  const opened = bridge(sync, depth(157, 160, [
    ["0.0024", "1"],
    ["0.0025", "3"],
  ], [
    ["0.0027", "1"],
    ["0.0026", "3"],
  ]));
  assert.equal(opened.healthy, true);
  const view = readSpotDepthView(opened, { levels: 10 });
  assert.equal(view.ok, true);
  assert.equal(view.executable, true);
  assert.equal(view.blocked, null);
  assert.equal(view.bound, 10);
  assert.equal(view.validityTimestamp, firstTime);
  assert.deepEqual(view.bids, [["0.0025", "3"], ["0.0024", "1"]]);
  assert.deepEqual(view.asks, [["0.0026", "3"], ["0.0027", "1"]]);
  assert.deepEqual(view.bbo, {
    bidPrice: "0.0025",
    bidQty: "3",
    askPrice: "0.0026",
    askQty: "3",
  });
  assert.equal(view.spread, "0.0001");
  assert.equal(view.bidQuantityTotal, "4");
  assert.equal(view.askQuantityTotal, "4");
  assert.equal(view.imbalance, "0");
  assert.equal(view.bids.some((row) => row[0] === "0.001"), false);
  assert.equal("fill" in view, false);
  assert.equal(Object.isFrozen(view), true);
  assert.throws(() => {
    view.bbo.bidPrice = "0.001";
  }, TypeError);

  const replaced = sync.ingestDepth(depth(161, 161, [["0.0025", "2"]], [], nextTime), nextTime);
  const later = readSpotDepthView(replaced, { levels: 25 });
  assert.equal(later.executable, true);
  assert.equal(later.validityTimestamp, nextTime);
  assert.deepEqual(later.bids[0], ["0.0025", "2"]);
  assert.equal(later.bidQuantityTotal, "3");
  assert.equal(later.askQuantityTotal, "4");
  assert.equal(later.imbalance, "-1/7");
  assert.equal(readSpotDepthView(replaced, { levels: 50 }).bound, 50);
});

test("the configured bound keeps only the best levels in the quantity total", () => {
  const bids = [];
  for (let rank = 0; rank < 12; rank += 1) {
    bids.push([`0.${String(30 - rank).padStart(4, "0")}`, "1"]);
  }
  const sync = createSpotBookSync("BNBBTC");
  const event = depth(157, 160, bids, [["0.0031", "10"]]);
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(event, event.E).book, null);
  const opened = sync.ingestSnapshot({
    lastUpdateId: 157,
    bids: [["0.0030", "1"]],
    asks: [["0.0031", "1"]],
  });
  const view = readSpotDepthView(opened, { levels: 10 });
  assert.equal(view.executable, true);
  assert.equal(view.bids.length, 10);
  assert.equal(view.bids[0][0], "0.0030");
  assert.equal(view.bids[9][0], "0.0021");
  assert.equal(view.bids.some((row) => row[0] === "0.0019"), false);
  assert.equal(view.bidQuantityTotal, "10");
  assert.equal(view.askQuantityTotal, "10");
  assert.equal(view.imbalance, "0");
  assert.equal(view.spread, "0.0001");
  assert.deepEqual(DEPTH_LEVEL_BOUNDS, [10, 25, 50]);
  assert.equal(readSpotDepthView(opened, { levels: 5 }).error, "depth bound is not configured");
  assert.equal(readSpotDepthView(opened, { levels: 5000 }).executable, false);
});

test("a stale book and a last trade price produce no executable depth", () => {
  const sync = createSpotBookSync("BNBBTC");
  const opened = bridge(sync, depth(157, 160, [["0.0024", "10"]], [["0.0026", "100"]]));
  assert.equal(sync.notePing(0).healthy, true);
  const stale = sync.status(SPOT_STREAM_LIFECYCLE.pongDeadlineMs);
  assert.equal(stale.healthy, false);
  assert.equal(stale.reason, "stale stream");
  const hidden = readSpotDepthView(stale, { levels: 10 });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.executable, false);
  assert.equal(hidden.blocked, "BLOCKED");
  assert.equal(hidden.reason, "stale stream");
  assert.equal(hidden.bbo, null);
  assert.equal(hidden.spread, null);
  assert.equal(hidden.imbalance, null);
  assert.deepEqual(hidden.bids, []);
  assert.deepEqual(hidden.asks, []);
  assert.equal(hidden.validityTimestamp, null);
  const substituted = readSpotDepthView(stale, { levels: 10, price: "0.001" });
  assert.equal(substituted.ok, false);
  assert.equal(substituted.executable, false);
  assert.equal(substituted.blocked, "BLOCKED");
  assert.equal("bids" in substituted, false);
  assert.equal(JSON.stringify(substituted).includes("0.001"), false);
  const healthyTrade = readSpotDepthView(opened, { levels: 10, lastPrice: "0.001" });
  assert.equal(healthyTrade.executable, false);
  assert.equal(healthyTrade.ok, false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
