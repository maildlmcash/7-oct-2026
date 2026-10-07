import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createMarketQueue } from "../services/market-event-queue.mjs";

// Caller-supplied. The source names no queue cap or retry budget.
const capacity = 8;
const retryBudget = 2;
const publishes = 10000;

function event(sequence) {
  return {
    venue: "Binance",
    product: "Spot",
    symbol: "BNBBTC",
    sequence,
    price: "0.001",
    quantity: "100",
    eventTime: 1672515782136,
    receiveTime: "1672515782137",
    schemaVersion: "2026-09-18",
    rawEventReference: "raw-1",
  };
}

test("load keeps a bounded queue and marks overload degraded", () => {
  assert.equal(createMarketQueue({}).error, "queue cap is required");
  assert.equal(createMarketQueue({ capacity }).error, "retry budget is required");
  const queue = createMarketQueue({ capacity, retryBudget });
  const before = process.memoryUsage().heapUsed;
  let accepted = 0;
  let refused = 0;
  for (let sequence = 0; sequence < publishes; sequence += 1) {
    const result = queue.publish(event(sequence));
    assert.equal(result.dropped, false);
    if (result.accepted) accepted += 1;
    else {
      refused += 1;
      assert.equal(result.reason, "queue cap");
      assert.equal(result.event.sequence, sequence);
      assert.equal(result.quality, "degraded");
    }
    assert.ok(queue.stats().retained <= capacity);
  }
  const stats = queue.stats();
  const after = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({
    backbone: stats.backbone,
    retained: stats.retained,
    capacity: stats.capacity,
    refused: stats.refused,
    dropped: stats.dropped,
    lag: stats.lag,
    quality: stats.quality,
    heapBefore: before,
    heapAfter: after,
  }));
  assert.equal(stats.backbone, "NATS JetStream");
  assert.equal(accepted, capacity);
  assert.equal(refused, publishes - capacity);
  assert.equal(stats.retained, capacity);
  assert.equal(stats.depth, capacity);
  assert.equal(stats.refused, publishes - capacity);
  assert.equal(stats.dropped, 0);
  assert.equal(stats.lag, capacity);
  assert.equal(stats.overloaded, true);
  assert.equal(stats.quality, "degraded");
  assert.equal(stats.blocked, "BLOCKED");
  const held = queue.deadLetters();
  assert.equal(held.length, 0);
  const first = queue.consume();
  assert.equal(first.event.sequence, 0);
  assert.equal(first.event.price, "0.001");
  assert.equal(queue.ack(first.id).dropped, false);
  assert.equal(queue.stats().retained, capacity - 1);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("retry budget sends the event to the dead letter and keeps it", () => {
  const queue = createMarketQueue({ capacity: 1, retryBudget });
  const published = queue.publish(event(12345));
  assert.equal(published.accepted, true);
  const first = queue.consume();
  assert.equal(queue.fail(first.id).dead, false);
  const second = queue.consume();
  const dead = queue.fail(second.id);
  assert.equal(dead.dead, true);
  assert.equal(dead.dropped, false);
  assert.equal(dead.quality, "degraded");
  assert.equal(dead.event.sequence, 12345);
  assert.equal(dead.event.quantity, "100");
  assert.equal(queue.deadLetters()[0].attempts, retryBudget);
  assert.equal(queue.stats().retained, 1);
  assert.equal(queue.stats().deadLetters, 1);
  const overflow = queue.publish(event(12346));
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.dropped, false);
  assert.equal(overflow.event.sequence, 12346);
  assert.equal(queue.deadLetters()[0].event.sequence, 12345);
  assert.equal(queue.stats().dropped, 0);
  assert.equal(queue.stats().quality, "degraded");
});
