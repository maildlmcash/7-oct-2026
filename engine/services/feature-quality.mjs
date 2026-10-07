// Point-in-time leakage and source-quality checks for TASK 10.C.02.
// Design page 8 says feature values come only from data up to the decision time.
// A late event, a future timestamp, a lookahead window, or an invalid source vetoes
// the dependent score. This module does not calculate that score.
// Event time after receive time is the existing clock-skew rule. The source names no
// skew allowance and no max event lag, so the lag threshold is caller-supplied.
// A missing threshold, decision time, or window fails closed and publishes no score.

import { FEATURE_DEFINITION_FORMULAS } from "./feature-versions.mjs";

const DIGITS = /^(?:0|[1-9]\d*)$/;
const NAMES = Object.freeze(FEATURE_DEFINITION_FORMULAS.map((feature) => feature.name));
const INVALID_REASONS = Object.freeze([
  "stale stream",
  "degraded",
  "sequence gap",
  "clock skew",
  "reorg",
  "unverified",
]);
const INPUT_KEYS = Object.freeze(["asOf", "receiveTime", "lagThreshold", "features", "score"]);
const FEATURE_KEYS = Object.freeze(["name", "source", "eventTime", "window", "quality"]);
const WINDOW_KEYS = Object.freeze(["from", "to"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);

export const FEATURE_QUALITY_CHECKS = Object.freeze([
  "late event",
  "future timestamp",
  "lookahead window",
  "invalid source",
]);

function result(fields) {
  return Object.freeze({
    ok: fields.ok,
    blocked: fields.ok ? null : "BLOCKED",
    error: fields.error,
    vetoed: fields.vetoed,
    score: null,
    feature: fields.feature ?? null,
    source: fields.source ?? null,
    check: fields.check ?? null,
    checked: fields.checked ?? null,
  });
}

function veto(error, check, feature, source) {
  return result({
    ok: false,
    error,
    vetoed: true,
    check,
    feature,
    source,
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

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeBig(value) {
  return BigInt(typeof value === "number" ? String(value) : value);
}

function qualityOf(value) {
  if (value === undefined || value === null) return { ok: false, missing: true };
  if (value === "degraded") return { ok: true, invalid: true, error: "degraded" };
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false, malformed: true };
  if (typeof value.healthy !== "boolean") return { ok: false, malformed: true };
  if (value.reason !== null && typeof value.reason !== "string") return { ok: false, malformed: true };
  if (value.healthy === true && value.reason === null) return { ok: true, invalid: false };
  if (typeof value.reason === "string" && INVALID_REASONS.includes(value.reason)) {
    return { ok: true, invalid: true, error: value.reason };
  }
  return { ok: true, invalid: true, error: "invalid source" };
}

function windowOf(value) {
  if (value === undefined || value === null) return { ok: false, missing: true };
  if (!plainObject(value) || unknownKey(value, WINDOW_KEYS)) return { ok: false, malformed: true };
  if (!timeValue(value.from) || !timeValue(value.to)) return { ok: false, malformed: true };
  if (timeBig(value.from) > timeBig(value.to)) return { ok: false, malformed: true };
  return { ok: true, from: value.from, to: value.to };
}

function featureOf(value) {
  if (!plainObject(value) || unknownKey(value, FEATURE_KEYS)) return { ok: false, malformed: true };
  if (!filled(value.name) || !NAMES.includes(value.name)) return { ok: false, malformed: true };
  if (value.source === undefined || value.source === null || value.source === "") {
    return { ok: false, feature: value.name, error: "source is not configured" };
  }
  if (!filled(value.source)) return { ok: false, malformed: true };
  if (!timeValue(value.eventTime)) return { ok: false, malformed: true };
  const window = windowOf(value.window);
  if (!window.ok) {
    if (window.missing) {
      return {
        ok: false,
        feature: value.name,
        source: value.source,
        check: "lookahead window",
        error: "lookahead window is not configured",
      };
    }
    return { ok: false, malformed: true };
  }
  const quality = qualityOf(value.quality);
  if (!quality.ok) {
    if (quality.missing) {
      return {
        ok: false,
        feature: value.name,
        source: value.source,
        check: "invalid source",
        error: "source quality is not configured",
      };
    }
    return { ok: false, malformed: true };
  }
  return {
    ok: true,
    feature: value.name,
    source: value.source,
    eventTime: value.eventTime,
    window,
    quality,
  };
}

function inspect(row, asOf, receiveTime, lagThreshold) {
  const event = timeBig(row.eventTime);
  const received = timeBig(receiveTime);
  const decision = timeBig(asOf);
  if (event > received) {
    return veto("clock skew", "future timestamp", row.feature, row.source);
  }
  if (received - event > timeBig(lagThreshold)) {
    return veto("late event", "late event", row.feature, row.source);
  }
  if (event > decision || timeBig(row.window.from) > decision || timeBig(row.window.to) > decision) {
    return veto("lookahead window", "lookahead window", row.feature, row.source);
  }
  if (row.quality.invalid) {
    return veto(row.quality.error, "invalid source", row.feature, row.source);
  }
  return null;
}

export function checkFeatureQuality(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return veto("unsupported field");
  if (input.asOf === undefined || input.asOf === null || input.asOf === "") {
    return veto("decision time is not configured");
  }
  if (!timeValue(input.asOf)) return veto("unsupported field");
  if (input.receiveTime === undefined || input.receiveTime === null || input.receiveTime === "") {
    return veto("receive time is required");
  }
  if (!timeValue(input.receiveTime)) return veto("unsupported field");
  if (input.lagThreshold === undefined || input.lagThreshold === null || input.lagThreshold === "") {
    return veto("lag threshold is not configured");
  }
  if (!timeValue(input.lagThreshold)) return veto("unsupported field");
  if (!Array.isArray(input.features) || input.features.length === 0) return veto("feature is not configured");
  const rows = [];
  for (const feature of input.features) {
    const built = featureOf(feature);
    if (!built.ok) {
      if (built.malformed) return veto("unsupported field");
      return veto(built.error, built.check ?? null, built.feature ?? null, built.source ?? null);
    }
    rows.push(built);
  }
  const rank = new Map(NAMES.map((name, index) => [name, index]));
  rows.sort((left, right) => rank.get(left.feature) - rank.get(right.feature));
  for (const row of rows) {
    const failed = inspect(row, input.asOf, input.receiveTime, input.lagThreshold);
    if (failed) return failed;
  }
  return result({
    ok: true,
    error: null,
    vetoed: false,
    checked: Object.freeze(rows.map((row) => Object.freeze({
      feature: row.feature,
      source: row.source,
    }))),
  });
}
