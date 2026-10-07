import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { SPOT_STREAM_LIFECYCLE } from "../services/binance-spot-public.mjs";
import { replayRecordedFixtures, runFeedSoak } from "../services/feed-soak.mjs";

// Caller-supplied. The source names no queue cap or retry budget.
const capacity = 2;
const retryBudget = 2;

test("soak report records uptime, lag, reconnects, and drops, and replay matches", () => {
  const report = runFeedSoak({ capacity, retryBudget });
  const again = replayRecordedFixtures();
  assert.equal(report.ok, true);
  assert.equal(report.uptime, "24 hours");
  assert.equal(report.uptimeMs, SPOT_STREAM_LIFECYCLE.connectionValidMs);
  assert.equal(report.lag, 2);
  assert.equal(report.reconnects, 1);
  assert.deepEqual(report.reconnectReasons, ["24 hours"]);
  assert.equal(report.drops, 0);
  assert.equal(report.constraints.retention, "NOT IN SOURCE");
  assert.equal(report.constraints.licensing, "NOT IN SOURCE");
  assert.equal(report.constraints.retentionDetail.includes("no retention period"), true);
  assert.equal(report.constraints.licensingDetail.includes("No licence grant is recorded"), true);
  assert.deepEqual(again.events, report.replay);
  assert.deepEqual(replayRecordedFixtures().events, again.events);
  assert.equal(report.replay[0].symbol, "BNBBTC");
  assert.equal(report.replay[0].price, "0.001");
  assert.equal(report.replay[0].quantity, "100");
  assert.equal(report.replay[0].sequence, 12345);
  assert.equal(report.replay[0].eventTime, 1672515782136);
  assert.equal(report.replay[0].schemaVersion, "2026-09-18");
  assert.equal(report.replay[1].price, "4.00000100");
  assert.equal(report.replay[1].quantity, "12.00000000");
  assert.equal(report.replay[1].sequence, 28457);
  assert.equal(report.replay[1].eventTime, 1499865549590);
  assert.equal(report.replay[1].rawEventReference, "raw-2");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  console.log(JSON.stringify({
    uptime: report.uptime,
    uptimeMs: report.uptimeMs,
    lag: report.lag,
    reconnects: report.reconnects,
    drops: report.drops,
    retention: report.constraints.retention,
    licensing: report.constraints.licensing,
    replay: report.replay.map((event) => ({
      symbol: event.symbol,
      price: event.price,
      quantity: event.quantity,
      sequence: event.sequence,
    })),
  }));
});
