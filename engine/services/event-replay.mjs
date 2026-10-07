// Deterministic event replay for TASK 13.A.01.
// A manifest is replayed in event-time order. Each stream keeps its own
// sequence watermark. The feature values come from replayFeatures, which
// calls the production feature calculator.
// Equal event times keep manifest order. The source names no general
// sequence-gap size, so a later sequence is accepted.
// A sequence at or behind the watermark is stale and publishes no feature
// numbers. This module does not score a model and does not place an order.

import { createHash } from "node:crypto";
import { replayFeatures } from "./feature-versions.mjs";

export const EVENT_REPLAY_CHECKSUM = "sha256";

const DIGITS = /^(?:0|[1-9]\d*)$/;
const SYMBOL = /^[A-Z0-9]+$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze(["featureVersions", "manifest"]);
const MANIFEST_KEYS = Object.freeze(["featureVersion", "events"]);
const EVENT_KEYS = Object.freeze([
  "predictionId",
  "schemaVersion",
  "venue",
  "product",
  "symbol",
  "eventTime",
  "receiveTime",
  "sequence",
  "quality",
  "bidPrice",
  "askPrice",
  "bidDepth",
  "askDepth",
  "trades",
  "funding",
  "openInterest",
  "basis",
  "liquidation",
]);
const FEATURE_FIELDS = Object.freeze([
  "eventTime",
  "sequence",
  "quality",
  "bidPrice",
  "askPrice",
  "bidDepth",
  "askDepth",
  "trades",
  "funding",
  "openInterest",
  "basis",
  "liquidation",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    checksum: null,
    predictions: null,
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function leaked(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function timeOf(value, missing) {
  if (value === undefined || value === null || value === "") return { ok: false, error: missing };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { ok: false, error: "unsupported field" };
    return { ok: true, value };
  }
  if (!filled(value) || !DIGITS.test(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

function receiveOf(value) {
  if (value === undefined || value === null || value === "") return { ok: false, error: "receive time is required" };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { ok: false, error: "unsupported field" };
    return { ok: true, value };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function timeBig(value) {
  return BigInt(typeof value === "number" ? String(value) : value);
}

function storeOf(store) {
  return Boolean(store) && store.versions instanceof Map && store.predictions instanceof Map;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function featureInput(event, sequenceWatermark) {
  const input = { sequenceWatermark };
  for (const key of FEATURE_FIELDS) {
    if (event[key] !== undefined) input[key] = event[key];
  }
  return input;
}

function streamKey(event) {
  return `${event.venue}\u0000${event.product}\u0000${event.symbol}`;
}

export function replayEventManifest(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (!storeOf(input.featureVersions)) return fail("unsupported field");
  if (!plainObject(input.manifest) || unknownKey(input.manifest, MANIFEST_KEYS)) return fail("unsupported field");
  const version = named(input.manifest.featureVersion, "feature version is not configured");
  if (!version.ok) return fail(version.error);
  if (!Array.isArray(input.manifest.events) || input.manifest.events.length === 0) {
    return fail("prediction is not configured");
  }
  const seen = new Set();
  for (const event of input.manifest.events) {
    if (!plainObject(event) || unknownKey(event, EVENT_KEYS)) return fail("unsupported field");
    const predictionId = named(event.predictionId, "prediction is not configured");
    if (!predictionId.ok) return fail(predictionId.error);
    if (seen.has(predictionId.value)) return fail("prediction version is already recorded");
    seen.add(predictionId.value);
    const schemaVersion = named(event.schemaVersion, "schema version is required");
    if (!schemaVersion.ok) return fail(schemaVersion.error);
    const venue = named(event.venue, "venue is required");
    if (!venue.ok) return fail(venue.error);
    const product = named(event.product, "product is required");
    if (!product.ok) return fail(product.error);
    if (event.symbol === undefined || event.symbol === null || event.symbol === "") {
      return fail("symbol is required");
    }
    if (typeof event.symbol !== "string" || !SYMBOL.test(event.symbol)) return fail("unsupported field");
    const eventTime = timeOf(event.eventTime, "event time is required");
    if (!eventTime.ok) return fail(eventTime.error);
    const receiveTime = receiveOf(event.receiveTime);
    if (!receiveTime.ok) return fail(receiveTime.error);
    const sequence = timeOf(event.sequence, "sequence is required");
    if (!sequence.ok) return fail(sequence.error);
  }
  const ordered = input.manifest.events.map((event, index) => ({ event, index }));
  ordered.sort((left, right) => {
    const compared = timeBig(left.event.eventTime) - timeBig(right.event.eventTime);
    if (compared < 0n) return -1;
    if (compared > 0n) return 1;
    return left.index - right.index;
  });
  const watermarks = new Map();
  const predictions = [];
  for (const item of ordered) {
    const event = item.event;
    const key = streamKey(event);
    const previous = watermarks.has(key) ? watermarks.get(key) : null;
    const replay = replayFeatures(input.featureVersions, {
      version: version.value,
      events: featureInput(event, previous),
    });
    if (!replay.ok) return fail(replay.error);
    if (!replay.stale && replay.inputWatermark !== null) watermarks.set(key, event.sequence);
    predictions.push(Object.freeze({
      predictionId: event.predictionId,
      schemaVersion: event.schemaVersion,
      venue: event.venue,
      product: event.product,
      symbol: event.symbol,
      eventTime: event.eventTime,
      receiveTime: event.receiveTime,
      featureVersion: replay.featureVersion,
      checksum: replay.checksum,
      stale: replay.stale,
      inputWatermark: replay.inputWatermark,
      sequenceWatermark: replay.sequenceWatermark,
      features: replay.features,
    }));
  }
  const body = Object.freeze(predictions);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    checksum: createHash(EVENT_REPLAY_CHECKSUM).update(canonical(body)).digest("hex"),
    predictions: body,
  });
}
