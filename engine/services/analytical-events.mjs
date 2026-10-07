// Analytical event store for TASK 10.A.01.
// Design section 18 selects ClickHouse plus immutable Parquet/object storage
// for high-volume trades, features, and replay, and keeps PostgreSQL for
// transactional state. This module does not open ClickHouse, write a Parquet
// file, or insert a PostgreSQL row.
// The source names no retention period, no deletion rule, and no partition key.
// A missing partition or retention period fails closed. A supplied period is a
// caller fixture. String event times are not deleted.

import { isKnownRole } from "../packages/contracts/src/roles.mjs";
import { canEditChecklist, canReadChecklistStatus } from "./checklist-status-view.mjs";

export const ANALYTICAL_PATH = "ClickHouse + immutable Parquet/object storage";

export const DELETION_BEHAVIOR = Object.freeze({
  automatic: false,
  detail: "The source names no retention period and no deletion rule. A row stays until a caller supplies a retention period and a clock. String event times are not deleted.",
});

export const STORAGE_ESTIMATE_NOTE = "Canonical JSON byte length of the rows visible to this actor. This is not a ClickHouse compression estimate.";

const WRITE_KEYS = Object.freeze(["actor", "tenantId", "partition", "event"]);
const READ_KEYS = Object.freeze(["actor", "partition"]);
const RETENTION_KEYS = Object.freeze(["actor", "retentionMs", "now"]);
const ESTIMATE_KEYS = Object.freeze(["actor"]);
const ACTOR_KEYS = Object.freeze(["role", "tenantId"]);
const EVENT_KEYS = Object.freeze([
  "eventTime",
  "receiveTime",
  "venue",
  "product",
  "symbol",
  "sequence",
  "price",
  "quantity",
  "schemaVersion",
  "rawEventReference",
]);
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const SENSITIVE_KEYS = new Set([
  "password",
  "otp",
  "apisecret",
  "privatekey",
  "seedphrase",
  "accesstoken",
  "credential",
  "credentials",
  "secret",
  "apikey",
  "authorization",
  "bearer",
  "cookie",
]);
const BOOK_KEYS = new Set([
  "bids",
  "asks",
  "ticks",
  "tickstream",
  "orderbook",
  "rawticks",
  "bookticks",
  "depthticks",
]);

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
}

function denied() {
  return fail("role scope denied");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function exactTime(value) {
  if (typeof value === "number") return whole(value);
  return filled(value);
}

function sequence(value) {
  if (typeof value === "number") return whole(value);
  return typeof value === "string" && DIGITS.test(value);
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function sensitiveValue(value) {
  return typeof value === "string" && (
    value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
    || /bearer\s+/i.test(value)
  );
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    visit(key, item);
    walk(item, visit);
  }
}

function rejection(value) {
  let sensitive = false;
  let book = false;
  walk(value, (key, item) => {
    const name = normalizeKey(key);
    if (SENSITIVE_KEYS.has(name)) sensitive = true;
    if (BOOK_KEYS.has(name)) book = true;
    if (sensitiveValue(item)) sensitive = true;
  });
  if (sensitive) return "sensitive field";
  if (book) return "raw order book";
  return null;
}

function actorOf(input) {
  if (!plainObject(input.actor) || unknownKey(input.actor, ACTOR_KEYS)) return null;
  if (!isKnownRole(input.actor.role) || !filled(input.actor.tenantId)) return null;
  return { role: input.actor.role, tenantId: input.actor.tenantId };
}

function eventReady(event) {
  if (!plainObject(event) || unknownKey(event, EVENT_KEYS)) return false;
  for (const key of EVENT_KEYS) {
    if (!Object.hasOwn(event, key)) return false;
  }
  return exactTime(event.eventTime)
    && exactTime(event.receiveTime)
    && filled(event.venue)
    && filled(event.product)
    && typeof event.symbol === "string"
    && SYMBOL.test(event.symbol)
    && sequence(event.sequence)
    && typeof event.price === "string"
    && DECIMAL.test(event.price)
    && typeof event.quantity === "string"
    && DECIMAL.test(event.quantity)
    && filled(event.schemaVersion)
    && filled(event.rawEventReference);
}

function copyEvent(event) {
  return Object.freeze({
    eventTime: event.eventTime,
    receiveTime: event.receiveTime,
    venue: event.venue,
    product: event.product,
    symbol: event.symbol,
    sequence: event.sequence,
    price: event.price,
    quantity: event.quantity,
    schemaVersion: event.schemaVersion,
    rawEventReference: event.rawEventReference,
  });
}

function stored(store) {
  return Boolean(store) && Array.isArray(store.rows) && typeof store.nextId === "number";
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function visible(actor, row, partition) {
  if (row.tenantId !== actor.tenantId) return false;
  if (!canReadChecklistStatus(actor, row.tenantId)) return false;
  if (partition !== undefined && row.partition !== partition) return false;
  return true;
}

function publish(row) {
  return Object.freeze({
    id: row.id,
    path: row.path,
    tenantId: row.tenantId,
    partition: row.partition,
    schemaVersion: row.schemaVersion,
    event: row.event,
  });
}

export function createAnalyticalStore() {
  return { nextId: 1, rows: [] };
}

export function storeAnalyticalEvent(store, input) {
  const target = stored(store) ? store : null;
  if (!target || !plainObject(input) || !plainObject(input.event)) return fail("unsupported field");
  const blocked = rejection(input.event);
  if (blocked) return fail(blocked);
  if (unknownKey(input, WRITE_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  if (!Object.hasOwn(input, "partition") || !filled(input.partition)) return fail("partition is not configured");
  if (!filled(input.tenantId) || input.tenantId !== actor.tenantId || !canEditChecklist(actor, input.tenantId)) {
    return denied();
  }
  if (!eventReady(input.event)) return fail("unsupported field");
  const event = copyEvent(input.event);
  const row = {
    id: `analytical-${target.nextId}`,
    path: ANALYTICAL_PATH,
    tenantId: input.tenantId,
    partition: input.partition,
    schemaVersion: event.schemaVersion,
    event,
  };
  target.nextId += 1;
  target.rows.push(row);
  return { ok: true, blocked: null, event: publish(row) };
}

export function readAnalyticalEvents(store, input) {
  if (!stored(store) || !plainObject(input) || unknownKey(input, READ_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  if (Object.hasOwn(input, "partition") && !filled(input.partition)) return fail("partition is not configured");
  const events = [];
  for (const row of store.rows) {
    if (visible(actor, row, input.partition)) events.push(publish(row));
  }
  return { ok: true, blocked: null, events: Object.freeze(events) };
}

export function applyAnalyticalRetention(store, input) {
  if (!stored(store) || !plainObject(input) || unknownKey(input, RETENTION_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor || !canEditChecklist(actor, actor.tenantId)) return denied();
  if (!whole(input.retentionMs) || input.retentionMs < 1) return fail("retention period is not configured");
  if (!whole(input.now)) return fail("unsupported field");
  const cutoff = input.now - input.retentionMs;
  if (!Number.isSafeInteger(cutoff)) return fail("unsupported field");
  let deleted = 0;
  const kept = [];
  for (const row of store.rows) {
    const sameTenant = row.tenantId === actor.tenantId;
    const numericTime = typeof row.event.eventTime === "number";
    if (sameTenant && numericTime && row.event.eventTime < cutoff) {
      deleted += 1;
      continue;
    }
    kept.push(row);
  }
  store.rows = kept;
  return {
    ok: true,
    blocked: null,
    deleted,
    retained: kept.length,
    deletion: DELETION_BEHAVIOR,
  };
}

export function estimateAnalyticalStorage(store, input) {
  if (!stored(store) || !plainObject(input) || unknownKey(input, ESTIMATE_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  const rows = store.rows.filter((row) => visible(actor, row)).map(publish);
  const bytes = Buffer.byteLength(canonical(rows), "utf8");
  return {
    ok: true,
    blocked: null,
    rows: rows.length,
    bytes,
    note: STORAGE_ESTIMATE_NOTE,
    deletion: DELETION_BEHAVIOR,
  };
}
