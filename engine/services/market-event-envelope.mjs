// Canonical public market-event envelope for TASK 07.B.01.
// Design section 2 names an immutable log of adapter raw messages with a
// source timestamp, a receive timestamp, and a sequence number.
// Price and quantity stay decimal strings. Raw public messages are append-only.
// This module does not place orders and does not detect sequence gaps.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;

function fail(error) {
  return { ok: false, error, blocked: "BLOCKED" };
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function exactTime(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return text(value);
}

function sequence(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function symbol(value) {
  return typeof value === "string" && SYMBOL.test(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function store(log) {
  if (!log || !Array.isArray(log.raw) || !Array.isArray(log.events) || typeof log.nextId !== "number") {
    return null;
  }
  return log;
}

export function createEventLog() {
  return { nextId: 1, raw: [], events: [] };
}

export function appendRawPublicMessage(log, message) {
  const target = store(log);
  if (!target) return fail("raw public message is required");
  let copy = null;
  if (typeof message === "string") {
    if (!text(message)) return fail("raw public message is required");
    copy = message;
  } else if (message && typeof message === "object") {
    copy = deepFreeze(structuredClone(message));
  }
  if (copy == null) return fail("raw public message is required");
  const reference = `raw-${target.nextId}`;
  target.nextId += 1;
  const row = Object.freeze({ reference, message: copy });
  target.raw.push(row);
  return { ok: true, blocked: null, reference, message: row.message };
}

export function readRawPublicMessage(log, reference) {
  const target = store(log);
  if (!target || !text(reference)) return fail("raw event reference is required");
  const row = target.raw.find((item) => item.reference === reference);
  if (!row) return fail("raw event reference is required");
  return { ok: true, blocked: null, reference: row.reference, message: row.message };
}

export function normalizeMarketEvent(log, input) {
  const target = store(log);
  if (!target) return fail("event time is required");
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (!exactTime(source.eventTime)) return fail("event time is required");
  if (!exactTime(source.receiveTime)) return fail("receive time is required");
  if (!text(source.venue)) return fail("venue is required");
  if (!text(source.product)) return fail("product is required");
  if (!symbol(source.symbol)) return fail("symbol is required");
  if (!sequence(source.sequence)) return fail("sequence is required");
  if (!decimal(source.price)) return fail("price is required");
  if (!decimal(source.quantity)) return fail("quantity is required");
  if (!text(source.schemaVersion)) return fail("schema version is required");
  if (!text(source.rawEventReference)) return fail("raw event reference is required");
  const raw = target.raw.find((item) => item.reference === source.rawEventReference);
  if (!raw) return fail("raw event reference is required");
  const event = Object.freeze({
    eventTime: source.eventTime,
    receiveTime: source.receiveTime,
    venue: source.venue,
    product: source.product,
    symbol: source.symbol,
    sequence: source.sequence,
    price: source.price,
    quantity: source.quantity,
    schemaVersion: source.schemaVersion,
    rawEventReference: source.rawEventReference,
  });
  target.events.push(event);
  return { ok: true, blocked: null, event };
}

export function readMarketEvents(log) {
  const target = store(log);
  if (!target) return fail("raw event reference is required");
  return { ok: true, blocked: null, events: target.events.slice() };
}
