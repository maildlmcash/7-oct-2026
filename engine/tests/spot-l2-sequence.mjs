import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createSpotBookSync } from "../services/spot-book-sync.mjs";

// Official diff-depth example. These strings are not a live quote.
const depth = {
  e: "depthUpdate",
  E: 1672515782136,
  s: "BNBBTC",
  U: 157,
  u: 160,
  b: [["0.0024", "10"]],
  a: [["0.0026", "100"]],
};

function event(U, u, quantity) {
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

function snapshot(lastUpdateId) {
  return {
    lastUpdateId,
    bids: [["4.00000000", "431.00000000"]],
    asks: [["4.00000200", "12.00000000"]],
  };
}

function openedBook() {
  const sync = createSpotBookSync("BNBBTC");
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(depth, depth.E).book, null);
  const opened = sync.ingestSnapshot(snapshot(157));
  assert.equal(opened.healthy, true);
  assert.equal(opened.book.updateId, 160);
  return sync;
}

test("an out-of-order buffer stays invalid until the first received U is bridged", () => {
  const sync = createSpotBookSync("BNBBTC");
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(event(161, 162, "11"), depth.E).book, null);
  assert.equal(sync.ingestDepth(depth, depth.E).book, null);
  const behind = sync.ingestSnapshot(snapshot(156));
  assert.equal(behind.healthy, false);
  assert.equal(behind.book, null);
  assert.equal(behind.action, "resnapshot");
  const opened = sync.ingestSnapshot(snapshot(161));
  assert.equal(opened.healthy, true);
  assert.equal(opened.book.updateId, 162);
  assert.deepEqual(opened.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "11"]);
});

test("an older final update id is ignored and the current book stays valid", () => {
  const sync = openedBook();
  const ignored = sync.ingestDepth(event(150, 159, "11"), depth.E);
  assert.equal(ignored.healthy, true);
  assert.equal(ignored.book.updateId, 160);
  assert.deepEqual(ignored.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "10"]);
});

test("a duplicate final update id leaves the book invalid until a newer event", () => {
  const sync = openedBook();
  const duplicate = sync.ingestDepth(depth, depth.E);
  assert.equal(duplicate.healthy, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.book, null);
  assert.equal(sync.status(0).book, null);
  const next = sync.ingestDepth(event(161, 161, "10"), depth.E);
  assert.equal(next.healthy, true);
  assert.equal(next.book.updateId, 161);
});

test("a sequence gap discards the book until a bridging snapshot", () => {
  const sync = openedBook();
  const gap = sync.ingestDepth(event(162, 163, "11"), depth.E);
  assert.equal(gap.healthy, false);
  assert.equal(gap.reason, "sequence gap");
  assert.equal(gap.action, "resnapshot");
  assert.equal(gap.book, null);
  assert.equal(sync.ingestDepth(event(163, 164, "12"), depth.E).book, null);
  const healed = sync.ingestSnapshot(snapshot(162));
  assert.equal(healed.healthy, true);
  assert.equal(healed.book.updateId, 164);
  assert.deepEqual(healed.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "12"]);
});

test("a snapshot older than the first buffered event does not publish the book", () => {
  const sync = createSpotBookSync("BNBBTC");
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(depth, depth.E).book, null);
  assert.equal(sync.ingestDepth(event(161, 161, "11"), depth.E).book, null);
  const raced = sync.ingestSnapshot(snapshot(156));
  assert.equal(raced.healthy, false);
  assert.equal(raced.book, null);
  assert.equal(raced.action, "resnapshot");
  assert.equal(sync.ingestDepth(event(162, 162, "12"), depth.E).book, null);
  const bridged = sync.ingestSnapshot(snapshot(157));
  assert.equal(bridged.healthy, true);
  assert.equal(bridged.book.updateId, 162);
  assert.deepEqual(bridged.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "12"]);
  assert.deepEqual(bridged.book.bids.find((row) => row[0] === "4.00000000"), ["4.00000000", "431.00000000"]);
});

test("reconnect and an invalid depth payload both require a new snapshot", () => {
  const sync = openedBook();
  const dropped = sync.noteReconnect(1);
  assert.equal(dropped.healthy, false);
  assert.equal(dropped.reason, "reconnect");
  assert.equal(dropped.action, "resnapshot");
  assert.equal(dropped.book, null);
  assert.equal(sync.ingestDepth(event(161, 162, "11"), depth.E).book, null);
  const restored = sync.ingestSnapshot(snapshot(161));
  assert.equal(restored.healthy, true);
  assert.equal(restored.book.updateId, 162);

  const invalid = sync.ingestDepth({ ...event(170, 169, "10") }, depth.E);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.healthy, false);
  assert.equal(invalid.book, null);
  assert.equal(invalid.error, "depth schema is not allowed");
  const after = sync.status(1);
  assert.equal(after.healthy, false);
  assert.equal(after.book, null);
  assert.equal(after.reason, "depth schema is not allowed");
  assert.equal(after.action, "resnapshot");
  assert.equal(sync.ingestDepth(event(163, 164, "13"), depth.E).book, null);
  const again = sync.ingestSnapshot(snapshot(163));
  assert.equal(again.healthy, true);
  assert.equal(again.book.updateId, 164);
  assert.deepEqual(again.book.bids.find((row) => row[0] === "0.0024"), ["0.0024", "13"]);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
