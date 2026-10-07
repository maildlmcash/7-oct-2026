import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { SPOT_STREAM_LIFECYCLE, spotStreamName } from "../services/binance-spot-public.mjs";
import { createSpotBookSync, spotDepthResyncTargets } from "../services/spot-book-sync.mjs";

const depth = {
  e: "depthUpdate",
  E: 1672515782136,
  s: "BNBBTC",
  U: 157,
  u: 160,
  b: [["0.0024", "10"]],
  a: [["0.0026", "100"]],
};

const bridge = {
  lastUpdateId: 157,
  bids: [["4.00000000", "431.00000000"]],
  asks: [["4.00000200", "12.00000000"]],
};

function depthEvent(U, u, quantity) {
  return {
    e: "depthUpdate",
    E: depth.E,
    s: "BNBBTC",
    U,
    u,
    b: [["0.0024", quantity]],
    a: [["0.0026", "100"]],
  };
}

function healedBook() {
  const sync = createSpotBookSync("BNBBTC");
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(depth, depth.E).healthy, false);
  const unbridged = sync.ingestSnapshot({
    lastUpdateId: 1027024,
    bids: [["4.00000000", "431.00000000"]],
    asks: [["4.00000200", "12.00000000"]],
  });
  assert.equal(unbridged.healthy, false);
  assert.equal(unbridged.book, null);
  assert.equal(sync.ingestDepth(depth, depth.E).healthy, false);
  const opened = sync.ingestSnapshot(bridge);
  assert.equal(opened.healthy, true);
  assert.equal(opened.book.updateId, 160);
  assert.deepEqual(opened.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "10"]);
  assert.deepEqual(opened.book.asks.find((row) => row[0] === "0.0026"), ["0.0026", "100"]);
  assert.deepEqual(opened.book.bids.find((row) => row[0] === "4.00000000"), ["4.00000000", "431.00000000"]);
  return sync;
}

test("a sequence gap stays unhealthy until a bridging snapshot", () => {
  const targets = spotDepthResyncTargets("BNBBTC");
  assert.equal(targets.snapshotUrl, "https://data-api.binance.vision/api/v3/depth?symbol=BNBBTC&limit=5000");
  assert.equal(targets.streamUrl, "wss://data-stream.binance.vision:443/ws/bnbbtc@depth");
  assert.equal(spotStreamName("BNBBTC", "depth").error, "stream is not allowed");
  const sync = healedBook();

  const gap = sync.ingestDepth(depthEvent(162, 163, "11"), depth.E);
  assert.equal(gap.healthy, false);
  assert.equal(gap.reason, "sequence gap");
  assert.equal(gap.action, "resnapshot");
  assert.equal(gap.book, null);
  assert.equal(gap.intervals.some((item) => item.fault === "sequence gap" && item.healed === false), true);
  const stillOpen = sync.ingestDepth(depthEvent(163, 164, "11"), depth.E);
  assert.equal(stillOpen.healthy, false);
  assert.equal(stillOpen.book, null);

  const healed = sync.ingestSnapshot({
    lastUpdateId: 162,
    bids: [["4.00000000", "431.00000000"]],
    asks: [["4.00000200", "12.00000000"]],
  });
  assert.equal(healed.healthy, true);
  assert.equal(healed.book.updateId, 164);
  assert.deepEqual(healed.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "11"]);
  assert.equal(healed.intervals.every((item) => item.healed === true), true);
});

test("a duplicate depth event is not healthy data", () => {
  const sync = healedBook();
  const duplicate = sync.ingestDepth(depth, depth.E);
  assert.equal(duplicate.healthy, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.book, null);
  assert.equal(sync.status(0).healthy, false);
  assert.equal(sync.status(0).book, null);
  const next = sync.ingestDepth(depthEvent(161, 161, "10"), depth.E);
  assert.equal(next.healthy, true);
  assert.equal(next.book.updateId, 161);
  assert.deepEqual(next.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "10"]);
});

test("a missed pong and a 24 hour connection are not healthy", () => {
  const sync = healedBook();
  assert.equal(sync.notePing(0).healthy, true);
  const missed = sync.status(SPOT_STREAM_LIFECYCLE.pongDeadlineMs);
  assert.equal(missed.healthy, false);
  assert.equal(missed.reason, "stale stream");
  assert.equal(missed.action, "reconnect");
  assert.equal(missed.book, null);
  assert.equal(sync.notePong(SPOT_STREAM_LIFECYCLE.pongDeadlineMs).healthy, false);
  const day = healedBook();
  const expired = day.status(SPOT_STREAM_LIFECYCLE.connectionValidMs);
  assert.equal(expired.healthy, false);
  assert.equal(expired.reason, "stale stream");
  assert.equal(expired.book, null);
});

test("reconnect and clock skew stay unhealthy until healed", () => {
  const sync = healedBook();
  const dropped = sync.noteReconnect(1);
  assert.equal(dropped.healthy, false);
  assert.equal(dropped.reason, "reconnect");
  assert.equal(dropped.action, "resnapshot");
  assert.equal(dropped.book, null);
  const early = sync.ingestDepth(depthEvent(161, 162, "12"), depth.E);
  assert.equal(early.healthy, false);
  assert.equal(early.book, null);
  const restored = sync.ingestSnapshot({
    lastUpdateId: 161,
    bids: [["4.00000000", "431.00000000"]],
    asks: [["4.00000200", "12.00000000"]],
  });
  assert.equal(restored.healthy, true);
  assert.equal(restored.book.updateId, 162);

  const delay = sync.ingestDepth(depthEvent(163, 163, "10"), depth.E + 60_000);
  assert.equal(delay.healthy, true);
  const skew = sync.ingestDepth(depthEvent(164, 164, "13"), depth.E - 1);
  assert.equal(skew.healthy, false);
  assert.equal(skew.reason, "clock skew");
  assert.equal(skew.book, null);
  assert.equal(skew.intervals.some((item) => item.fault === "clock skew" && item.healed === false), true);
  const aligned = sync.ingestDepth(depthEvent(165, 165, "10"), depth.E);
  assert.equal(aligned.healthy, true);
  assert.equal(aligned.book.updateId, 165);
  assert.equal(aligned.intervals.every((item) => item.healed === true), true);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
