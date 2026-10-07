import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as analytical from "../services/analytical-events.mjs";
import {
  ANALYTICAL_PATH,
  DELETION_BEHAVIOR,
  applyAnalyticalRetention,
  createAnalyticalStore,
  estimateAnalyticalStorage,
  readAnalyticalEvents,
  storeAnalyticalEvent,
} from "../services/analytical-events.mjs";
import {
  appendRawPublicMessage,
  createEventLog,
  normalizeMarketEvent,
} from "../services/market-event-envelope.mjs";

// Partition text and the retention period are NOT IN SOURCE. The decimals and
// event time 1499865549590 are the documented recent-trade example.
const ADMIN = { role: "Admin", tenantId: "tenant-a" };
const CUSTOMER = { role: "Customer", tenantId: "tenant-a" };
const PARTITION = "fixture-partition";
const OTHER_PARTITION = "fixture-other-partition";

function envelope(eventTime, sequence) {
  const log = createEventLog();
  const raw = appendRawPublicMessage(log, {
    id: sequence,
    price: "4.00000100",
    qty: "12.00000000",
  });
  assert.equal(raw.ok, true, raw.error);
  const normalized = normalizeMarketEvent(log, {
    eventTime,
    receiveTime: "1672515782137",
    venue: "Binance",
    product: "Spot",
    symbol: "ETHBTC",
    sequence,
    price: "4.00000100",
    quantity: "12.00000000",
    schemaVersion: "fixture-1",
    rawEventReference: raw.reference,
  });
  assert.equal(normalized.ok, true, normalized.error);
  return normalized.event;
}

function put(store, event, partition = PARTITION, actor = ADMIN) {
  const result = storeAnalyticalEvent(store, {
    actor,
    tenantId: actor.tenantId,
    partition,
    event,
  });
  assert.equal(result.ok, true, result.error);
  return result.event;
}

test("partitions keep schema version and tenant access", () => {
  const store = createAnalyticalStore();
  const first = put(store, envelope(1499865549590, 28457));
  put(store, envelope(1499865549591, 28458), OTHER_PARTITION);
  assert.equal(first.path, ANALYTICAL_PATH);
  assert.equal(first.schemaVersion, "fixture-1");
  assert.equal(first.tenantId, "tenant-a");
  assert.equal(first.event.price, "4.00000100");

  const one = readAnalyticalEvents(store, { actor: ADMIN, partition: PARTITION });
  const other = readAnalyticalEvents(store, { actor: CUSTOMER, partition: OTHER_PARTITION });
  assert.equal(one.events.length, 1);
  assert.equal(one.events[0].event.sequence, 28457);
  assert.equal(other.events.length, 1);
  assert.equal(other.events[0].partition, OTHER_PARTITION);

  const cross = readAnalyticalEvents(store, { actor: { role: "Admin", tenantId: "tenant-b" } });
  const distributor = readAnalyticalEvents(store, { actor: { role: "Distributor", tenantId: "tenant-a" } });
  assert.deepEqual(cross.events, []);
  assert.deepEqual(distributor.events, []);
  assert.equal(JSON.stringify(cross).includes("4.00000100"), false);

  const customerWrite = storeAnalyticalEvent(store, {
    actor: CUSTOMER,
    tenantId: "tenant-a",
    partition: PARTITION,
    event: envelope(1499865549592, 28459),
  });
  assert.equal(customerWrite.error, "role scope denied");
  assert.equal(store.rows.length, 2);

  const missingPartition = storeAnalyticalEvent(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    event: envelope(1499865549593, 28460),
  });
  assert.equal(missingPartition.error, "partition is not configured");
  assert.equal(store.rows.length, 2);

  const widened = readAnalyticalEvents(store, { actor: CUSTOMER, granted: true });
  assert.equal(widened.error, "role scope denied");
  assert.equal(Object.hasOwn(widened, "events"), false);
});

test("retention stays closed until a caller period, and the estimate is the visible byte length", () => {
  const store = createAnalyticalStore();
  put(store, envelope(1000, 1));
  put(store, envelope(5000, 2));
  put(store, envelope("1499865549590", 3));
  const before = estimateAnalyticalStorage(store, { actor: ADMIN });
  assert.equal(before.rows, 3);
  assert.equal(before.bytes > 0, true);
  assert.equal(before.note.includes("not a ClickHouse"), true);
  assert.equal(before.deletion, DELETION_BEHAVIOR);
  assert.equal(before.deletion.automatic, false);

  const closed = applyAnalyticalRetention(store, { actor: ADMIN, now: 4000 });
  assert.equal(closed.ok, false);
  assert.equal(closed.error, "retention period is not configured");
  assert.equal(store.rows.length, 3);

  const applied = applyAnalyticalRetention(store, {
    actor: ADMIN,
    retentionMs: 1000,
    now: 4000,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.deleted, 1);
  assert.equal(applied.retained, 2);
  assert.equal(applied.deletion.detail.includes("no retention period"), true);
  const times = readAnalyticalEvents(store, { actor: ADMIN }).events.map((row) => row.event.eventTime);
  assert.deepEqual(times, [5000, "1499865549590"]);

  const customerDelete = applyAnalyticalRetention(store, {
    actor: CUSTOMER,
    retentionMs: 1,
    now: 9000,
  });
  assert.equal(customerDelete.error, "role scope denied");
  assert.equal(store.rows.length, 2);

  const after = estimateAnalyticalStorage(store, { actor: ADMIN });
  const hidden = estimateAnalyticalStorage(store, { actor: { role: "Admin", tenantId: "tenant-b" } });
  assert.equal(after.rows, 2);
  assert.equal(after.bytes < before.bytes, true);
  assert.equal(hidden.rows, 0);
  assert.equal(hidden.bytes, 2);

  const migrations = readdirSync(new URL("../data/migrations/", import.meta.url));
  for (const name of migrations) {
    if (!name.endsWith(".sql")) continue;
    const sql = readFileSync(new URL(`../data/migrations/${name}`, import.meta.url), "utf8");
    assert.equal(sql.includes("analytical_event"), false, name);
  }
});

test("secrets and raw books are rejected and paper mode stays locked", () => {
  const store = createAnalyticalStore();
  const secret = storeAnalyticalEvent(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    partition: PARTITION,
    event: { ...envelope(1499865549590, 4), password: "hunter2" },
  });
  assert.equal(secret.error, "sensitive field");
  const book = storeAnalyticalEvent(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    partition: PARTITION,
    event: { ...envelope(1499865549590, 5), bids: [["1", "1"]] },
  });
  assert.equal(book.error, "raw order book");
  assert.equal(store.rows.length, 0);
  assert.equal(JSON.stringify(secret).includes("hunter2"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(analytical, name), false);
  }
});
