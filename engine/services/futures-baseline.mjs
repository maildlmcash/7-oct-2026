// Futures target and baseline for TASK 12.B.01.
// Design page 8 publishes the futures signed score and keeps it apart from Spot.
// Design page 11 names Spot horizons and says the futures horizon and contract
// family stay separate. It does not name the futures duration.
// The label is the contract-family mark return. Linear uses the start mark as
// the denominator. Inverse uses the outcome mark.
// The net adds the execution-cost net return, the caller funding, and the
// caller liquidation. A missing funding or liquidation is not zero.
// The Spot baseline and Spot label schema are rejected.
// This module does not place orders and does not fit a probability.

import { createHash } from "node:crypto";
import { readExecutionCost } from "./execution-costs.mjs";
import { FEATURE_QUALITY_CHECKS, checkFeatureQuality } from "./feature-quality.mjs";

const UNSIGNED = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const DECIMAL_VALUE = new RegExp(`^(-?)(${UNSIGNED})$`);
const FRACTION_VALUE = new RegExp(`^(-?)(${UNSIGNED})/(${UNSIGNED})$`);
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const FAMILIES = new Set(["linear", "inverse"]);
const FEATURES = Object.freeze([
  "PriceTrend",
  "OIPriceImpulse",
  "TakerFlow",
  "FundingCrowding",
  "BasisSignal",
  "LiquidationFlow",
  "CrossVenueConfirmation",
]);
const WEIGHTS = Object.freeze({
  PriceTrend: 18,
  OIPriceImpulse: 18,
  TakerFlow: 16,
  FundingCrowding: 14,
  BasisSignal: 12,
  LiquidationFlow: 12,
  CrossVenueConfirmation: 10,
});
const MODEL_KEYS = Object.freeze(["version", "contractFamily", "horizon", "duration"]);
const LABEL_KEYS = Object.freeze(["version", "contractFamily", "horizon", "duration"]);
const OUTCOME_KEYS = Object.freeze(["version", "cutoff", "start", "outcome", "quality"]);
const MARK_KEYS = Object.freeze(["mark", "time"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);
const INVALID_REASONS = Object.freeze([
  "stale stream",
  "degraded",
  "sequence gap",
  "clock skew",
  "reorg",
  "unverified",
]);
const SCORE_KEYS = Object.freeze(["version", "features"]);
const EVALUATE_KEYS = Object.freeze(["futures", "manifest"]);
const MANIFEST_KEYS = Object.freeze([
  "datasetId",
  "modelVersion",
  "featureVersion",
  "labelVersion",
  "contractFamily",
  "horizon",
  "duration",
  "window",
  "folds",
  "rows",
]);
const WINDOW_KEYS = Object.freeze(["from", "to"]);
const FOLD_KEYS = Object.freeze(["name", "trainEnd", "testStart", "testEnd"]);
const ROW_KEYS = Object.freeze([
  "name",
  "fold",
  "regime",
  "features",
  "leakage",
  "label",
  "cost",
  "funding",
  "liquidation",
  "benchmarkNet",
]);
const LEAKAGE_KEYS = Object.freeze(["receiveTime", "lagThreshold", "features"]);
const ROW_LABEL_KEYS = Object.freeze(["cutoff", "start", "outcome", "quality"]);
const COST_KEYS = Object.freeze(["bids", "asks", "quantity", "feeRate"]);

export const FUTURES_PRODUCT = "futures";
export const FUTURES_FEATURES = FEATURES;
export const FUTURES_WEIGHTS = WEIGHTS;
export const FUTURES_FORMULA = "100 * (0.18*PriceTrend + 0.18*OIPriceImpulse + 0.16*TakerFlow + 0.14*FundingCrowding + 0.12*BasisSignal + 0.12*LiquidationFlow + 0.10*CrossVenueConfirmation)";
export const FUTURES_LABEL = "contract-family mark return";
export const FUTURES_NET = "label return plus execution net return plus funding plus liquidation";
export const FUTURES_CHECKSUM = "sha256";
export const FUTURES_BENCHMARK = "supplied net-of-cost benchmark";
export const FUTURES_BENCHMARK_DIFFERENCE = "evaluated net minus supplied benchmark";
export const FUTURES_BRIER = "NOT IN SOURCE";
export const FUTURES_LOG_LOSS = "NOT IN SOURCE";
export const FUTURES_DRAWDOWN = "NOT IN SOURCE";
export const FUTURES_UNCERTAINTY = "NOT IN SOURCE";
export const FUTURES_CALIBRATION = "predicted probability buckets vs observed outcome";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    product: null,
    contractFamily: null,
    modelVersion: null,
    labelVersion: null,
    horizon: null,
    duration: null,
    formula: null,
    score: null,
    calibratedProbability: null,
    label: null,
    return: null,
    costsApplied: false,
    checksum: null,
    netPerformance: null,
  });
}

function pinFail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    checksum: null,
    manifest: null,
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

function storeOf(store) {
  return Boolean(store)
    && store.kind === "futures"
    && store.models instanceof Map
    && store.labels instanceof Map
    && store.outcomes instanceof Map;
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

function familyOf(value) {
  const read = named(value, "contract family is not configured");
  if (!read.ok) return read;
  if (!FAMILIES.has(read.value)) return { ok: false, error: "contract family is not supported" };
  return read;
}

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeBig(value) {
  return BigInt(typeof value === "number" ? String(value) : value);
}

function timeText(value) {
  return timeBig(value).toString();
}

function compareTime(left, right) {
  const a = timeText(left);
  const b = timeText(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function durationOf(value) {
  if (value === undefined || value === null || value === "") return { ok: false, error: "horizon is not configured" };
  if (!timeValue(value) || timeBig(value) <= 0n) return { ok: false, error: "horizon is not supported" };
  return { ok: true, value: timeText(value) };
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function parseUnsigned(value) {
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function parseSigned(value) {
  if (value === null || value === undefined) return { kind: "missing" };
  if (typeof value !== "string") return { kind: "bad" };
  if (value.trim() === "") return { kind: "missing" };
  const fraction = FRACTION_VALUE.exec(value);
  if (fraction) {
    const negative = fraction[1] === "-";
    const numerator = parseUnsigned(fraction[2]);
    const denominator = parseUnsigned(fraction[3]);
    if (denominator.n === 0n) return { kind: "bad" };
    return {
      kind: "value",
      value: {
        n: (negative ? -numerator.n : numerator.n) * 10n ** BigInt(denominator.scale),
        d: denominator.n * 10n ** BigInt(numerator.scale),
      },
    };
  }
  const decimalValue = DECIMAL_VALUE.exec(value);
  if (!decimalValue) return { kind: "bad" };
  const negative = decimalValue[1] === "-";
  const part = parseUnsigned(decimalValue[2]);
  return {
    kind: "value",
    value: {
      n: negative ? -part.n : part.n,
      d: 10n ** BigInt(part.scale),
    },
  };
}

function format(n, scale) {
  const neg = n < 0n;
  let digits = (neg ? -n : n).toString();
  if (scale > 0) {
    if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
    const cut = digits.length - scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  if (digits === "0") return "0";
  return neg ? `-${digits}` : digits;
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function ratio(numerator, denominator) {
  if (denominator === 0n) return null;
  const neg = (numerator < 0n) !== (denominator < 0n);
  let num = numerator < 0n ? -numerator : numerator;
  let den = denominator < 0n ? -denominator : denominator;
  const divisor = gcd(num, den);
  num /= divisor;
  den /= divisor;
  let rest = den;
  let twos = 0n;
  let fives = 0n;
  while (rest % 2n === 0n) {
    rest /= 2n;
    twos += 1n;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    fives += 1n;
  }
  if (rest !== 1n) return `${neg ? "-" : ""}${num.toString()}/${den.toString()}`;
  const scale = twos > fives ? twos : fives;
  const scaled = num * 2n ** (scale - twos) * 5n ** (scale - fives);
  return format(neg ? -scaled : scaled, Number(scale));
}

function addTexts(values) {
  let sum = { n: 0n, d: 1n };
  for (const value of values) {
    const part = parseSigned(value);
    if (!part || part.kind !== "value") return null;
    sum = { n: sum.n * part.value.d + part.value.n * sum.d, d: sum.d * part.value.d };
  }
  return ratio(sum.n, sum.d);
}

function clip(part) {
  const magnitude = part.n < 0n ? -part.n : part.n;
  if (magnitude > part.d) return { n: part.n < 0n ? -1n : 1n, d: 1n };
  return part;
}

function clampRatio(part) {
  const limit = 100n * part.d;
  if (part.n > limit) return "100";
  if (part.n < -limit) return "-100";
  return ratio(part.n, part.d);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function markOf(value) {
  if (!plainObject(value) || unknownKey(value, MARK_KEYS)) return { malformed: true };
  if (!timeValue(value.time)) return { malformed: true };
  const time = timeText(value.time);
  if (value.mark === undefined || value.mark === null || value.mark === "") return { missing: true, time };
  const parsed = parseDecimal(value.mark);
  if (!parsed || parsed.n === 0n) return { malformed: true };
  return { parsed, time };
}

function markReturn(family, start, outcome) {
  const scale = Math.max(start.scale, outcome.scale);
  const startN = start.n * 10n ** BigInt(scale - start.scale);
  const outcomeN = outcome.n * 10n ** BigInt(scale - outcome.scale);
  const difference = outcomeN - startN;
  return ratio(difference, family === "linear" ? startN : outcomeN);
}

function qualityError(value) {
  if (value === "degraded") return { error: "degraded", vetoed: true };
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { error: "unsupported field", vetoed: false };
  if (typeof value.healthy !== "boolean") return { error: "unsupported field", vetoed: false };
  if (value.reason !== null && typeof value.reason !== "string") return { error: "unsupported field", vetoed: false };
  if (value.healthy === true && value.reason === null) return null;
  if (typeof value.reason === "string" && INVALID_REASONS.includes(value.reason)) {
    return { error: value.reason, vetoed: true };
  }
  return { error: "invalid source", vetoed: true };
}

function intervalsOverlap(left, right) {
  return timeBig(left.cutoff) < timeBig(right.outcomeTime)
    && timeBig(right.cutoff) < timeBig(left.outcomeTime);
}

export function createFuturesStore() {
  return {
    kind: "futures",
    models: new Map(),
    labels: new Map(),
    outcomes: new Map(),
  };
}

export function registerFuturesModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, MODEL_KEYS)) return fail("unsupported field");
  const version = named(input.version, "model version is not configured");
  if (!version.ok) return fail(version.error);
  const family = familyOf(input.contractFamily);
  if (!family.ok) return fail(family.error);
  const horizon = named(input.horizon, "horizon is not configured");
  if (!horizon.ok) return fail(horizon.error);
  const duration = durationOf(input.duration);
  if (!duration.ok) return fail(duration.error);
  const record = Object.freeze({
    product: FUTURES_PRODUCT,
    modelVersion: version.value,
    contractFamily: family.value,
    horizon: horizon.value,
    duration: duration.value,
    formula: FUTURES_FORMULA,
    features: FEATURES,
    weights: WEIGHTS,
  });
  const prior = store.models.get(record.modelVersion);
  if (prior) {
    if (!same(prior, record)) return fail("model version is already registered");
    return Object.freeze({
      ok: true,
      blocked: null,
      error: null,
      product: prior.product,
      contractFamily: prior.contractFamily,
      modelVersion: prior.modelVersion,
      horizon: prior.horizon,
      duration: prior.duration,
      formula: prior.formula,
      score: null,
      calibratedProbability: null,
    });
  }
  store.models.set(record.modelVersion, record);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    product: record.product,
    contractFamily: record.contractFamily,
    modelVersion: record.modelVersion,
    horizon: record.horizon,
    duration: record.duration,
    formula: record.formula,
    score: null,
    calibratedProbability: null,
  });
}

export function registerFuturesLabel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, LABEL_KEYS)) return fail("unsupported field");
  const version = named(input.version, "label version is not configured");
  if (!version.ok) return fail(version.error);
  const family = familyOf(input.contractFamily);
  if (!family.ok) return fail(family.error);
  const horizon = named(input.horizon, "horizon is not configured");
  if (!horizon.ok) return fail(horizon.error);
  const duration = durationOf(input.duration);
  if (!duration.ok) return fail(duration.error);
  const record = Object.freeze({
    product: FUTURES_PRODUCT,
    version: version.value,
    contractFamily: family.value,
    horizon: horizon.value,
    duration: duration.value,
    targetReturn: FUTURES_LABEL,
    costsApplied: false,
  });
  const prior = store.labels.get(record.version);
  if (prior) {
    if (!same(prior, record)) return fail("label version is already registered");
    return Object.freeze({ ok: true, blocked: null, error: null, product: FUTURES_PRODUCT, definition: prior });
  }
  store.labels.set(record.version, record);
  return Object.freeze({ ok: true, blocked: null, error: null, product: FUTURES_PRODUCT, definition: record });
}

export function scoreFuturesModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, SCORE_KEYS)) return fail("unsupported field");
  const version = named(input.version, "model version is not configured");
  if (!version.ok) return fail(version.error);
  const record = store.models.get(version.value);
  if (!record) return fail("model version is not configured");
  if (!plainObject(input.features) || unknownKey(input.features, FEATURES)) {
    return fail("unsupported field");
  }
  let sum = { n: 0n, d: 1n };
  for (const name of FEATURES) {
    const parsed = parseSigned(input.features[name]);
    if (parsed.kind === "missing") return fail("signed feature is missing");
    if (parsed.kind !== "value") return fail("unsupported field");
    const part = clip(parsed.value);
    sum = {
      n: sum.n * part.d + BigInt(WEIGHTS[name]) * part.n * sum.d,
      d: sum.d * part.d,
    };
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    product: record.product,
    contractFamily: record.contractFamily,
    modelVersion: record.modelVersion,
    horizon: record.horizon,
    duration: record.duration,
    formula: record.formula,
    score: clampRatio(sum),
    calibratedProbability: null,
  });
}

export function labelFuturesOutcome(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, OUTCOME_KEYS)) return fail("unsupported field");
  const version = named(input.version, "label version is not configured");
  if (!version.ok) return fail(version.error);
  const definition = store.labels.get(version.value);
  if (!definition) return fail("label version is not configured");
  if (!timeValue(input.cutoff)) return fail("timestamp is not aligned");
  const cutoff = timeText(input.cutoff);
  const outcomeTime = (timeBig(input.cutoff) + timeBig(definition.duration)).toString();
  const start = markOf(input.start);
  const outcome = markOf(input.outcome);
  if (start.malformed || outcome.malformed) return fail("unsupported field");
  if (!start.time || !outcome.time) return fail("timestamp is not aligned");
  if (timeBig(start.time) > timeBig(cutoff)) return fail("lookahead window");
  if (start.time !== cutoff || outcome.time !== outcomeTime) return fail("timestamp is not aligned");
  const quality = qualityError(input.quality);
  if (quality) return fail(quality.error);
  if (start.missing || outcome.missing) return fail("mark price is missing");
  const returned = markReturn(definition.contractFamily, start.parsed, outcome.parsed);
  if (returned === null) return fail("unsupported field");
  const record = Object.freeze({
    product: FUTURES_PRODUCT,
    version: definition.version,
    contractFamily: definition.contractFamily,
    horizon: definition.horizon,
    duration: definition.duration,
    cutoff,
    outcomeTime,
    targetReturn: FUTURES_LABEL,
    return: returned,
    costsApplied: false,
  });
  const key = `${definition.version}\u0000${cutoff}`;
  const stored = store.outcomes.get(key);
  if (stored) {
    if (!same(stored, record)) return fail("label is already recorded");
  } else {
    for (const other of store.outcomes.values()) {
      if (other.version === record.version && intervalsOverlap(other, record)) return fail("overlapping window");
    }
    store.outcomes.set(key, record);
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    product: FUTURES_PRODUCT,
    contractFamily: record.contractFamily,
    labelVersion: record.version,
    horizon: record.horizon,
    duration: record.duration,
    return: record.return,
    costsApplied: false,
    formula: FUTURES_LABEL,
  });
}

function windowOf(value) {
  if (!plainObject(value) || unknownKey(value, WINDOW_KEYS)) return { ok: false, error: "unsupported field" };
  if (value.from === undefined || value.to === undefined) return { ok: false, error: "raw-data window is not configured" };
  if (!timeValue(value.from) || !timeValue(value.to) || compareTime(value.from, value.to) >= 0) {
    return { ok: false, error: "unsupported field" };
  }
  return { ok: true };
}

function foldsOf(folds) {
  if (!Array.isArray(folds) || folds.length === 0) return { ok: false, error: "folds are not configured" };
  const names = new Set();
  let previousStart = null;
  let previousEnd = null;
  for (const fold of folds) {
    if (!plainObject(fold) || unknownKey(fold, FOLD_KEYS)) return { ok: false, error: "unsupported field" };
    const name = named(fold.name, "fold is not configured");
    if (!name.ok) return name;
    if (names.has(name.value)) return { ok: false, error: "fold is already recorded" };
    names.add(name.value);
    if (!timeValue(fold.trainEnd) || !timeValue(fold.testStart) || !timeValue(fold.testEnd)) {
      return { ok: false, error: "unsupported field" };
    }
    if (compareTime(fold.trainEnd, fold.testStart) >= 0) return { ok: false, error: "fold is not unseen" };
    if (compareTime(fold.testStart, fold.testEnd) > 0) return { ok: false, error: "unsupported field" };
    if (previousStart !== null && compareTime(previousStart, fold.testStart) >= 0) {
      return { ok: false, error: "folds are not time-ordered" };
    }
    if (previousEnd !== null && compareTime(previousEnd, fold.testStart) >= 0) {
      return { ok: false, error: "overlapping window" };
    }
    previousStart = fold.testStart;
    previousEnd = fold.testEnd;
  }
  return { ok: true };
}

function rowsOf(rows, folds, window) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "rows are not configured" };
  const byName = new Map(folds.map((fold) => [fold.name, fold]));
  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    if (!plainObject(row) || unknownKey(row, ROW_KEYS)) return { ok: false, error: "unsupported field" };
    const name = named(row.name, "row is not configured");
    if (!name.ok) return name;
    if (seen.has(name.value)) return { ok: false, error: "row is already recorded" };
    seen.add(name.value);
    if (!filled(row.fold)) return { ok: false, error: "fold is not configured" };
    const fold = byName.get(row.fold);
    if (!fold) return { ok: false, error: "fold is not configured" };
    if (!filled(row.regime)) return { ok: false, error: "regime is not configured" };
    if (!plainObject(row.features) || unknownKey(row.features, FEATURES)) return { ok: false, error: "unsupported field" };
    if (!plainObject(row.leakage) || unknownKey(row.leakage, LEAKAGE_KEYS)) return { ok: false, error: "unsupported field" };
    if (!Array.isArray(row.leakage.features) || row.leakage.features.length === 0) {
      return { ok: false, error: "feature is not configured" };
    }
    if (!plainObject(row.label) || unknownKey(row.label, ROW_LABEL_KEYS)) return { ok: false, error: "unsupported field" };
    if (!timeValue(row.label.cutoff)) return { ok: false, error: "unsupported field" };
    if (previous !== null && compareTime(previous, row.label.cutoff) >= 0) {
      return { ok: false, error: "rows are not time-ordered" };
    }
    previous = row.label.cutoff;
    if (compareTime(row.label.cutoff, fold.testStart) < 0 || compareTime(row.label.cutoff, fold.testEnd) > 0) {
      return { ok: false, error: "row is outside the folds" };
    }
    if (compareTime(row.label.cutoff, window.from) < 0 || compareTime(row.label.cutoff, window.to) > 0) {
      return { ok: false, error: "row is outside the raw-data window" };
    }
    if (!plainObject(row.cost) || unknownKey(row.cost, COST_KEYS)) return { ok: false, error: "unsupported field" };
    if (row.funding === undefined) return { ok: false, error: "unsupported field" };
    if (parseSigned(row.funding).kind === "missing") return { ok: false, error: "funding is not configured" };
    if (parseSigned(row.funding).kind !== "value") return { ok: false, error: "unsupported field" };
    if (row.liquidation === undefined) return { ok: false, error: "unsupported field" };
    if (parseSigned(row.liquidation).kind === "missing") return { ok: false, error: "liquidation is not configured" };
    if (parseSigned(row.liquidation).kind !== "value") return { ok: false, error: "unsupported field" };
    if (row.benchmarkNet === undefined) return { ok: false, error: "unsupported field" };
    if (parseSigned(row.benchmarkNet).kind === "missing") return { ok: false, error: "benchmark is not configured" };
    if (parseSigned(row.benchmarkNet).kind !== "value") return { ok: false, error: "unsupported field" };
  }
  return { ok: true };
}

function prepare(manifest) {
  const dataset = named(manifest.datasetId, "dataset is not configured");
  if (!dataset.ok) return dataset;
  const modelVersion = named(manifest.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return modelVersion;
  const featureVersion = named(manifest.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return featureVersion;
  const labelVersion = named(manifest.labelVersion, "label version is not configured");
  if (!labelVersion.ok) return labelVersion;
  const family = familyOf(manifest.contractFamily);
  if (!family.ok) return family;
  const horizon = named(manifest.horizon, "horizon is not configured");
  if (!horizon.ok) return horizon;
  const duration = durationOf(manifest.duration);
  if (!duration.ok) return duration;
  const window = windowOf(manifest.window);
  if (!window.ok) return window;
  const folds = foldsOf(manifest.folds);
  if (!folds.ok) return folds;
  const rows = rowsOf(manifest.rows, manifest.folds, manifest.window);
  if (!rows.ok) return rows;
  return { ok: true };
}

function checksumOf(manifest) {
  return createHash(FUTURES_CHECKSUM).update(canonical(manifest)).digest("hex");
}

function metric(value, formula, sampleSize, costsApplied, note) {
  return Object.freeze({
    value,
    formula,
    sampleSize,
    uncertainty: null,
    uncertaintyFormula: FUTURES_UNCERTAINTY,
    costsApplied,
    note,
  });
}

function report(manifest, checksum, model, included, excluded, costsApplied, note) {
  const net = costsApplied ? addTexts(included.map((row) => row.rowNet)) : null;
  const benchmark = costsApplied ? addTexts(included.map((row) => row.benchmarkNet)) : null;
  const difference = costsApplied && net !== null && benchmark !== null
    ? addTexts([net, ratio(-(parseSigned(benchmark).value.n), parseSigned(benchmark).value.d)])
    : null;
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    product: FUTURES_PRODUCT,
    contractFamily: model.contractFamily,
    datasetId: manifest.datasetId,
    modelVersion: model.modelVersion,
    featureVersion: manifest.featureVersion,
    labelVersion: manifest.labelVersion,
    horizon: model.horizon,
    duration: model.duration,
    formula: model.formula,
    checksum,
    sampleSize: included.length,
    excludedSampleSize: excluded.length,
    scores: Object.freeze(included.map((row) => Object.freeze({
      name: row.name,
      score: row.score,
      calibratedProbability: null,
    }))),
    leakage: Object.freeze({
      excluded: excluded.length,
      rows: Object.freeze(excluded),
    }),
    netPerformance: metric(
      costsApplied ? net : null,
      FUTURES_NET,
      costsApplied ? included.length : 0,
      costsApplied,
      costsApplied ? null : note,
    ),
    benchmark: metric(
      costsApplied ? benchmark : null,
      FUTURES_BENCHMARK,
      costsApplied ? included.length : 0,
      costsApplied,
      costsApplied ? null : note,
    ),
    benchmarkDifference: metric(
      costsApplied ? difference : null,
      FUTURES_BENCHMARK_DIFFERENCE,
      costsApplied ? included.length : 0,
      costsApplied,
      costsApplied ? null : note,
    ),
    brier: metric(null, FUTURES_BRIER, included.length, false, null),
    logLoss: metric(null, FUTURES_LOG_LOSS, included.length, false, null),
    drawdown: metric(null, FUTURES_DRAWDOWN, included.length, false, null),
    calibration: Object.freeze({
      value: null,
      bins: Object.freeze([]),
      status: "insufficient",
      formula: FUTURES_CALIBRATION,
      note: "calibrated probability is not available",
    }),
  });
}

export function pinFuturesManifest(manifest) {
  if (!plainObject(manifest) || unknownKey(manifest, MANIFEST_KEYS)) return pinFail("unsupported field");
  const copy = structuredClone(manifest);
  const prepared = prepare(copy);
  if (!prepared.ok) return pinFail(prepared.error);
  const checksum = checksumOf(copy);
  const pinned = structuredClone(copy);
  pinned.checksum = checksum;
  return Object.freeze({ ok: true, blocked: null, error: null, checksum, manifest: pinned });
}

export function evaluateFuturesWalkForward(input) {
  if (!plainObject(input) || unknownKey(input, EVALUATE_KEYS)) return fail("unsupported field");
  if (!storeOf(input.futures)) return fail("unsupported field");
  if (!plainObject(input.manifest)) return fail("unsupported field");
  const manifest = structuredClone(input.manifest);
  if (unknownKey(manifest, [...MANIFEST_KEYS, "checksum"])) return fail("unsupported field");
  const checksum = manifest.checksum;
  delete manifest.checksum;
  const prepared = prepare(manifest);
  if (!prepared.ok) return fail(prepared.error);
  if (typeof checksum !== "string" || !CHECKSUM.test(checksum) || checksumOf(manifest) !== checksum) {
    return fail("manifest checksum does not match");
  }
  const model = input.futures.models.get(manifest.modelVersion);
  if (!model) return fail("model version is not configured");
  const label = input.futures.labels.get(manifest.labelVersion);
  if (!label) return fail("label version is not configured");
  if (model.contractFamily !== manifest.contractFamily || label.contractFamily !== manifest.contractFamily) {
    return fail("contract family is not supported");
  }
  if (model.horizon !== manifest.horizon || label.horizon !== manifest.horizon) return fail("horizon is not supported");
  if (model.duration !== timeText(manifest.duration) || label.duration !== timeText(manifest.duration)) {
    return fail("horizon is not supported");
  }
  const included = [];
  const excluded = [];
  for (const row of manifest.rows) {
    const checked = checkFeatureQuality({
      asOf: row.label.cutoff,
      receiveTime: row.leakage.receiveTime,
      lagThreshold: row.leakage.lagThreshold,
      features: row.leakage.features,
    });
    if (!checked.ok) {
      if (checked.vetoed && FEATURE_QUALITY_CHECKS.includes(checked.check)) {
        excluded.push(Object.freeze({
          name: row.name,
          check: checked.check,
          feature: checked.feature,
          source: checked.source,
        }));
        continue;
      }
      return fail(checked.error);
    }
    const scored = scoreFuturesModel(input.futures, {
      version: manifest.modelVersion,
      features: row.features,
    });
    if (!scored.ok) return fail(scored.error);
    included.push({
      name: row.name,
      score: scored.score,
      benchmarkNet: row.benchmarkNet,
      label: row.label,
      cost: row.cost,
      funding: row.funding,
      liquidation: row.liquidation,
    });
  }
  if (included.length === 0) return report(manifest, checksum, model, included, excluded, false, null);
  let costNote = null;
  for (const row of included) {
    const cost = readExecutionCost(row.cost);
    if (!cost.ok) {
      costNote = cost.error;
      break;
    }
    row.costNet = cost.netReturn;
  }
  if (costNote) return report(manifest, checksum, model, included, excluded, false, costNote);
  for (const row of included) {
    const labeled = labelFuturesOutcome(input.futures, {
      version: manifest.labelVersion,
      cutoff: row.label.cutoff,
      start: row.label.start,
      outcome: row.label.outcome,
      quality: row.label.quality,
    });
    if (!labeled.ok) return fail(labeled.error);
    const rowNet = addTexts([labeled.return, row.costNet, row.funding, row.liquidation]);
    if (rowNet === null) return fail("unsupported field");
    row.rowNet = rowNet;
  }
  return report(manifest, checksum, model, included, excluded, true, null);
}
