// Feature-definition versions for TASK 10.C.01.
// Each feature records its formula, lookback, timezone, source priority, and null policy.
// The formulas and the null policy are the TASK 10.A.02 rules. A different formula or a
// different null policy is rejected and calculates nothing.
// Exchange timestamps are UTC. Any other timezone is rejected.
// The source names no lookback duration and no venue priority order. Those fields are
// stored as supplied. This module does not apply a lookback window and does not merge venues.
// Replay runs the existing feature calculator. The same version and the same events
// return the same feature output. Every stored prediction cites that version.
// This module does not place orders and does not score a direction.

import { readMarketFeatures } from "./market-features.mjs";

const FEATURES = Object.freeze([
  ["spread", "best ask minus best bid"],
  ["depth imbalance", "(bid depth - ask depth) / (bid depth + ask depth)"],
  ["CVD", "cumulative taker buy minus taker sell"],
  ["VWAP", "NOT IN SOURCE"],
  ["volatility", "NOT IN SOURCE"],
  ["realized range", "NOT IN SOURCE"],
  ["funding", "source value"],
  ["open interest", "source value"],
  ["basis", "source value"],
  ["liquidation", "source value"],
]);

export const FEATURE_DEFINITION_FORMULAS = Object.freeze(
  FEATURES.map(([name, formula]) => Object.freeze({ name, formula })),
);
export const FEATURE_TIMEZONE = "UTC";
export const FEATURE_NULL_POLICY = "missing stays null";

const DEFINITION_KEYS = Object.freeze(["version", "features"]);
const FEATURE_KEYS = Object.freeze(["name", "formula", "lookback", "timezone", "sourcePriority", "nullPolicy"]);
const REPLAY_KEYS = Object.freeze(["version", "events"]);
const PREDICTION_KEYS = Object.freeze(["predictionId", "version", "events"]);
const READ_KEYS = Object.freeze(["predictionId"]);

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
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

function priorityOf(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set();
  const copy = [];
  for (const item of value) {
    if (!filled(item) || seen.has(item)) return null;
    seen.add(item);
    copy.push(item);
  }
  return Object.freeze(copy);
}

function definitionOf(input) {
  if (!plainObject(input) || unknownKey(input, DEFINITION_KEYS) || !filled(input.version)) {
    return fail("feature version is not configured");
  }
  if (!Array.isArray(input.features)) return fail("feature version is not configured");
  const byName = new Map();
  for (const feature of input.features) {
    if (!plainObject(feature) || unknownKey(feature, FEATURE_KEYS)) return fail("unsupported field");
    if (!filled(feature.name) || byName.has(feature.name)) return fail("unsupported field");
    if (!filled(feature.lookback)) return fail("lookback is not configured");
    if (feature.timezone === undefined || feature.timezone === null || feature.timezone === "") {
      return fail("timezone is not configured");
    }
    if (feature.timezone !== FEATURE_TIMEZONE) return fail("timezone is not supported");
    const sourcePriority = priorityOf(feature.sourcePriority);
    if (!sourcePriority) return fail("source priority is not configured");
    if (feature.nullPolicy === undefined || feature.nullPolicy === null || feature.nullPolicy === "") {
      return fail("null policy is not configured");
    }
    if (feature.nullPolicy !== FEATURE_NULL_POLICY) return fail("null policy is not supported");
    const expected = FEATURES.find(([name]) => name === feature.name);
    if (!expected || feature.formula !== expected[1]) return fail("formula is not supported");
    byName.set(feature.name, Object.freeze({
      name: feature.name,
      formula: feature.formula,
      lookback: feature.lookback,
      timezone: feature.timezone,
      sourcePriority,
      nullPolicy: feature.nullPolicy,
    }));
  }
  if (byName.size !== FEATURES.length) return fail("feature version is not configured");
  const features = Object.freeze(FEATURES.map(([name]) => byName.get(name)));
  const definition = Object.freeze({
    version: input.version,
    features,
    checksum: "",
  });
  const checksum = canonical({ version: definition.version, features: definition.features });
  return {
    ok: true,
    definition: Object.freeze({
      version: definition.version,
      features: definition.features,
      checksum,
    }),
  };
}

function stamp(calculated, definition) {
  const byName = new Map(definition.features.map((feature) => [feature.name, feature]));
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    stale: calculated.stale,
    inputWatermark: calculated.inputWatermark,
    sequenceWatermark: calculated.sequenceWatermark,
    featureVersion: definition.version,
    checksum: definition.checksum,
    features: Object.freeze(calculated.features.map((feature) => {
      const spec = byName.get(feature.name);
      return Object.freeze({
        name: feature.name,
        value: feature.value,
        eventTime: feature.eventTime,
        inputWatermark: feature.inputWatermark,
        quality: feature.quality,
        formula: feature.formula,
        featureVersion: definition.version,
        lookback: spec.lookback,
        timezone: spec.timezone,
        sourcePriority: spec.sourcePriority,
        nullPolicy: spec.nullPolicy,
      });
    })),
  });
}

export function createFeatureVersionStore() {
  return { versions: new Map(), predictions: new Map() };
}

export function registerFeatureVersion(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  const built = definitionOf(input);
  if (!built.ok) return built;
  const prior = store.versions.get(built.definition.version);
  if (prior) {
    if (prior.checksum !== built.definition.checksum) return fail("feature version is already registered");
    return Object.freeze({ ok: true, blocked: null, error: null, definition: prior });
  }
  store.versions.set(built.definition.version, built.definition);
  return Object.freeze({ ok: true, blocked: null, error: null, definition: built.definition });
}

export function replayFeatures(store, input) {
  if (!storeOf(store) || !plainObject(input) || unknownKey(input, REPLAY_KEYS)) return fail("unsupported field");
  if (!filled(input.version)) return fail("feature version is not configured");
  const definition = store.versions.get(input.version);
  if (!definition) return fail("feature version is not configured");
  if (!plainObject(input.events)) return fail("unsupported field");
  const calculated = readMarketFeatures(input.events);
  if (!calculated.ok) return fail(calculated.error);
  return stamp(calculated, definition);
}

export function recordPredictionFeatures(store, input) {
  if (!storeOf(store) || !plainObject(input) || unknownKey(input, PREDICTION_KEYS)) return fail("unsupported field");
  if (!filled(input.predictionId)) return fail("prediction is not configured");
  const replay = replayFeatures(store, { version: input.version, events: input.events });
  if (!replay.ok) return replay;
  const record = Object.freeze({
    predictionId: input.predictionId,
    featureVersion: replay.featureVersion,
    checksum: replay.checksum,
    stale: replay.stale,
    inputWatermark: replay.inputWatermark,
    sequenceWatermark: replay.sequenceWatermark,
    features: replay.features,
  });
  const prior = store.predictions.get(input.predictionId);
  if (prior) {
    if (canonical(prior) !== canonical(record)) return fail("prediction version is already recorded");
    return Object.freeze({ ok: true, blocked: null, error: null, prediction: prior });
  }
  store.predictions.set(input.predictionId, record);
  return Object.freeze({ ok: true, blocked: null, error: null, prediction: record });
}

export function readPredictionFeatures(store, input) {
  if (!storeOf(store) || !plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  if (!filled(input.predictionId)) return fail("prediction is not configured");
  const prediction = store.predictions.get(input.predictionId);
  if (!prediction) return fail("prediction is not recorded");
  return Object.freeze({ ok: true, blocked: null, error: null, prediction });
}
