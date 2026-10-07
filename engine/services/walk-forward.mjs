// Walk-forward evaluation for TASK 11.C.01.
// Folds, the dataset, and the model version come from a pinned manifest.
// A fold test starts strictly after its train end. The source names no embargo length.
// Leakage uses the existing feature-quality checks. Transaction costs use the execution-cost
// walk. The net is the label return plus that execution net return.
// Brier, log loss, drawdown, and uncertainty arithmetic are NOT IN SOURCE.
// The signed baseline has no calibrated probability, so calibration bins stay empty.
// The benchmark comparison subtracts the supplied benchmark total from the evaluated net.
// The source names the comparison and does not define a significance test.
// SHA-256 is the checksum already used for a pinned snapshot. The source names no algorithm.
// This module does not place orders and does not fit a model.

import { createHash } from "node:crypto";
import { scoreBaselineModel } from "./baseline-model.mjs";
import { readExecutionCost } from "./execution-costs.mjs";
import { FEATURE_QUALITY_CHECKS, checkFeatureQuality } from "./feature-quality.mjs";
import { SPOT_HORIZONS, labelOutcome, readLabelVersion } from "./label-definitions.mjs";

const UNSIGNED = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const DECIMAL_VALUE = new RegExp(`^(-?)(${UNSIGNED})$`);
const FRACTION_VALUE = new RegExp(`^(-?)(${UNSIGNED})/(${UNSIGNED})$`);
const DIGITS = /^(?:0|[1-9]\d*)$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const EVALUATE_KEYS = Object.freeze(["baseline", "labels", "manifest"]);
const MANIFEST_KEYS = Object.freeze([
  "datasetId",
  "modelVersion",
  "featureVersion",
  "labelVersion",
  "horizon",
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
  "benchmarkNet",
]);
const LEAKAGE_KEYS = Object.freeze(["receiveTime", "lagThreshold", "features"]);
const LABEL_KEYS = Object.freeze(["cutoff", "start", "outcome", "quality"]);
const COST_KEYS = Object.freeze(["bids", "asks", "quantity", "feeRate"]);

export const WALK_FORWARD_CHECKSUM = "sha256";
export const WALK_FORWARD_NET = "label return plus execution net return";
export const WALK_FORWARD_BENCHMARK = "supplied net-of-cost benchmark";
export const WALK_FORWARD_BENCHMARK_DIFFERENCE = "evaluated net minus supplied benchmark";
export const WALK_FORWARD_CALIBRATION = "predicted probability buckets vs observed outcome";
export const WALK_FORWARD_BRIER = "NOT IN SOURCE";
export const WALK_FORWARD_LOG_LOSS = "NOT IN SOURCE";
export const WALK_FORWARD_DRAWDOWN = "NOT IN SOURCE";
export const WALK_FORWARD_UNCERTAINTY = "NOT IN SOURCE";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    datasetId: null,
    modelVersion: null,
    featureVersion: null,
    labelVersion: null,
    horizon: null,
    formula: null,
    checksum: null,
    sampleSize: null,
    manifestSampleSize: null,
    excludedSampleSize: null,
    folds: Object.freeze([]),
    regimes: Object.freeze([]),
    leakage: null,
    netPerformance: null,
    benchmark: null,
    benchmarkDifference: null,
    brier: null,
    logLoss: null,
    calibration: null,
    drawdown: null,
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

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeText(value) {
  return BigInt(typeof value === "number" ? String(value) : value).toString();
}

function compareTime(left, right) {
  const a = timeText(left);
  const b = timeText(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function baselineStore(store) {
  return Boolean(store) && store.kind === "baseline" && store.versions instanceof Map;
}

function labelStore(store) {
  return Boolean(store) && store.versions instanceof Map && store.labels instanceof Map;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumOf(manifest) {
  return createHash(WALK_FORWARD_CHECKSUM).update(canonical(manifest)).digest("hex");
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

function parseUnsigned(value) {
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function parseSigned(value) {
  if (typeof value !== "string") return null;
  const fraction = FRACTION_VALUE.exec(value);
  if (fraction) {
    const negative = fraction[1] === "-";
    const numerator = parseUnsigned(fraction[2]);
    const denominator = parseUnsigned(fraction[3]);
    if (denominator.n === 0n) return null;
    return {
      n: (negative ? -numerator.n : numerator.n) * 10n ** BigInt(denominator.scale),
      d: denominator.n * 10n ** BigInt(numerator.scale),
    };
  }
  const decimal = DECIMAL_VALUE.exec(value);
  if (!decimal) return null;
  const negative = decimal[1] === "-";
  const part = parseUnsigned(decimal[2]);
  return {
    n: negative ? -part.n : part.n,
    d: 10n ** BigInt(part.scale),
  };
}

function addTexts(left, right) {
  const a = parseSigned(left);
  const b = parseSigned(right);
  if (!a || !b) return null;
  return ratio(a.n * b.d + b.n * a.d, a.d * b.d);
}

function subtractTexts(left, right) {
  const b = parseSigned(right);
  if (!b) return null;
  return addTexts(left, ratio(-b.n, b.d));
}

function totals(texts) {
  let sum = { n: 0n, d: 1n };
  for (const text of texts) {
    const part = parseSigned(text);
    if (!part) return null;
    sum = { n: sum.n * part.d + part.n * sum.d, d: sum.d * part.d };
  }
  if (texts.length === 0) return null;
  return {
    total: ratio(sum.n, sum.d),
    mean: ratio(sum.n, sum.d * BigInt(texts.length)),
  };
}

function metric(value, formula, sampleSize, extra) {
  return Object.freeze({
    value,
    mean: extra?.mean ?? null,
    formula,
    sampleSize,
    uncertainty: null,
    uncertaintyFormula: WALK_FORWARD_UNCERTAINTY,
    costsApplied: extra?.costsApplied ?? false,
    note: extra?.note ?? null,
  });
}

function named(value) {
  if (value === undefined || value === null || value === "") return { ok: false, missing: true };
  if (!filled(value)) return { ok: false, bad: true };
  return { ok: true, value };
}

function windowOf(value) {
  if (!plainObject(value) || unknownKey(value, WINDOW_KEYS)) return { ok: false, error: "unsupported field" };
  if (value.from === undefined || value.to === undefined) {
    return { ok: false, error: "raw-data window is not configured" };
  }
  if (!timeValue(value.from) || !timeValue(value.to) || compareTime(value.from, value.to) >= 0) {
    return { ok: false, error: "unsupported field" };
  }
  return { ok: true, from: value.from, to: value.to };
}

function foldsOf(folds) {
  if (!Array.isArray(folds) || folds.length === 0) return { ok: false, error: "folds are not configured" };
  const names = new Set();
  let previousStart = null;
  let previousEnd = null;
  for (const fold of folds) {
    if (!plainObject(fold) || unknownKey(fold, FOLD_KEYS)) return { ok: false, error: "unsupported field" };
    const name = named(fold.name);
    if (!name.ok) return { ok: false, error: name.bad ? "unsupported field" : "fold is not configured" };
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
    const name = named(row.name);
    if (!name.ok) return { ok: false, error: name.bad ? "unsupported field" : "row is not configured" };
    if (seen.has(name.value)) return { ok: false, error: "row is already recorded" };
    seen.add(name.value);
    if (!filled(row.fold)) return { ok: false, error: "fold is not configured" };
    const fold = byName.get(row.fold);
    if (!fold) return { ok: false, error: "fold is not configured" };
    if (typeof row.regime !== "string") return { ok: false, error: "unsupported field" };
    if (!filled(row.regime)) return { ok: false, error: "regime is not configured" };
    if (!plainObject(row.features)) return { ok: false, error: "unsupported field" };
    if (!plainObject(row.leakage) || unknownKey(row.leakage, LEAKAGE_KEYS)) {
      return { ok: false, error: "unsupported field" };
    }
    if (!Array.isArray(row.leakage.features) || row.leakage.features.length === 0) {
      return { ok: false, error: "feature is not configured" };
    }
    if (!plainObject(row.label) || unknownKey(row.label, LABEL_KEYS)) {
      return { ok: false, error: "unsupported field" };
    }
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
    if (row.benchmarkNet === undefined || row.benchmarkNet === null || row.benchmarkNet === "") {
      return { ok: false, error: "benchmark is not configured" };
    }
    if (!parseSigned(row.benchmarkNet)) return { ok: false, error: "unsupported field" };
  }
  return { ok: true };
}

function prepare(manifest) {
  const dataset = named(manifest.datasetId);
  if (!dataset.ok) return { ok: false, error: dataset.bad ? "unsupported field" : "dataset is not configured" };
  const modelVersion = named(manifest.modelVersion);
  if (!modelVersion.ok) {
    return { ok: false, error: modelVersion.bad ? "unsupported field" : "model version is not configured" };
  }
  const featureVersion = named(manifest.featureVersion);
  if (!featureVersion.ok) {
    return { ok: false, error: featureVersion.bad ? "unsupported field" : "feature version is not configured" };
  }
  const labelVersion = named(manifest.labelVersion);
  if (!labelVersion.ok) {
    return { ok: false, error: labelVersion.bad ? "unsupported field" : "label version is not configured" };
  }
  if (manifest.horizon === undefined || manifest.horizon === null || manifest.horizon === "") {
    return { ok: false, error: "horizon is not configured" };
  }
  if (!SPOT_HORIZONS.includes(manifest.horizon)) return { ok: false, error: "horizon is not supported" };
  const window = windowOf(manifest.window);
  if (!window.ok) return window;
  const folds = foldsOf(manifest.folds);
  if (!folds.ok) return folds;
  const rows = rowsOf(manifest.rows, manifest.folds, window);
  if (!rows.ok) return rows;
  return { ok: true, manifest };
}

function openMetric(formula, sampleSize, note) {
  return metric(null, formula, sampleSize, { note, costsApplied: false });
}

function groupBy(rows, key) {
  const order = [];
  const groups = new Map();
  for (const row of rows) {
    const name = row[key];
    if (!groups.has(name)) {
      groups.set(name, []);
      order.push(name);
    }
    groups.get(name).push(row);
  }
  return order.map((name) => ({ name, rows: groups.get(name) }));
}

function performance(rows, formula, costsApplied, note) {
  if (rows.length === 0) return openMetric(formula, 0, null);
  if (!costsApplied) return openMetric(formula, 0, note);
  const summed = totals(rows.map((row) => (formula === WALK_FORWARD_BENCHMARK ? row.benchmarkNet : row.rowNet)));
  if (!summed) return openMetric(formula, rows.length, "unsupported field");
  return metric(summed.total, formula, rows.length, { mean: summed.mean, costsApplied: true });
}

function difference(rows, costsApplied) {
  if (rows.length === 0 || !costsApplied) return openMetric(WALK_FORWARD_BENCHMARK_DIFFERENCE, 0, null);
  const evaluated = totals(rows.map((row) => row.rowNet));
  const benchmark = totals(rows.map((row) => row.benchmarkNet));
  if (!evaluated || !benchmark) return openMetric(WALK_FORWARD_BENCHMARK_DIFFERENCE, rows.length, "unsupported field");
  const value = subtractTexts(evaluated.total, benchmark.total);
  if (value === null) return openMetric(WALK_FORWARD_BENCHMARK_DIFFERENCE, rows.length, "unsupported field");
  return metric(value, WALK_FORWARD_BENCHMARK_DIFFERENCE, rows.length, { costsApplied: true });
}

function regimesOf(rows, costsApplied, note) {
  return Object.freeze(groupBy(rows, "regime").map((group) => Object.freeze({
    regime: group.name,
    sampleSize: group.rows.length,
    netPerformance: performance(group.rows, WALK_FORWARD_NET, costsApplied, note),
  })));
}

function withheld(manifest, checksum, record, included, excluded, note) {
  return report(manifest, checksum, record, included, excluded, false, note);
}

function report(manifest, checksum, record, included, excluded, costsApplied, note) {
  const folds = manifest.folds.map((fold) => {
    const rows = included.filter((row) => row.fold === fold.name);
    return Object.freeze({
      name: fold.name,
      trainEnd: timeText(fold.trainEnd),
      testStart: timeText(fold.testStart),
      testEnd: timeText(fold.testEnd),
      sampleSize: rows.length,
      scores: Object.freeze(rows.map((row) => Object.freeze({
        name: row.name,
        score: row.score,
        calibratedProbability: null,
      }))),
      regimes: regimesOf(rows, costsApplied, note),
      netPerformance: performance(rows, WALK_FORWARD_NET, costsApplied, note),
      benchmark: performance(rows, WALK_FORWARD_BENCHMARK, costsApplied, note),
      benchmarkDifference: difference(rows, costsApplied),
    });
  });
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    datasetId: manifest.datasetId,
    modelVersion: record.modelVersion,
    featureVersion: manifest.featureVersion,
    labelVersion: manifest.labelVersion,
    horizon: manifest.horizon,
    formula: record.formula,
    checksum,
    sampleSize: included.length,
    manifestSampleSize: manifest.rows.length,
    excludedSampleSize: excluded.length,
    folds: Object.freeze(folds),
    regimes: regimesOf(included, costsApplied, note),
    leakage: Object.freeze({
      excluded: excluded.length,
      rows: Object.freeze(excluded.map((row) => Object.freeze({
        name: row.name,
        check: row.check,
        feature: row.feature,
        source: row.source,
      }))),
    }),
    netPerformance: performance(included, WALK_FORWARD_NET, costsApplied, note),
    benchmark: performance(included, WALK_FORWARD_BENCHMARK, costsApplied, note),
    benchmarkDifference: difference(included, costsApplied),
    brier: metric(null, WALK_FORWARD_BRIER, included.length),
    logLoss: metric(null, WALK_FORWARD_LOG_LOSS, included.length),
    calibration: Object.freeze({
      value: null,
      bins: Object.freeze([]),
      status: "insufficient",
      formula: WALK_FORWARD_CALIBRATION,
      note: "calibrated probability is not available",
      sampleSize: included.length,
      uncertainty: null,
      uncertaintyFormula: WALK_FORWARD_UNCERTAINTY,
    }),
    drawdown: metric(null, WALK_FORWARD_DRAWDOWN, included.length),
  });
}

export function pinWalkForwardManifest(manifest) {
  if (!plainObject(manifest) || unknownKey(manifest, MANIFEST_KEYS)) return pinFail("unsupported field");
  const copy = structuredClone(manifest);
  const prepared = prepare(copy);
  if (!prepared.ok) return pinFail(prepared.error);
  const checksum = checksumOf(copy);
  const pinned = structuredClone(copy);
  pinned.checksum = checksum;
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    checksum,
    manifest: pinned,
  });
}

export function evaluateWalkForward(input) {
  if (!plainObject(input) || unknownKey(input, EVALUATE_KEYS)) return fail("unsupported field");
  if (!baselineStore(input.baseline) || !labelStore(input.labels)) return fail("unsupported field");
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
  const record = input.baseline.versions.get(manifest.modelVersion);
  if (!record) return fail("model version is not configured");
  const labelVersion = readLabelVersion(input.labels, { version: manifest.labelVersion });
  if (!labelVersion.ok) return fail(labelVersion.error);
  if (!labelVersion.definition.horizons.includes(manifest.horizon)) return fail("horizon is not supported");

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
        excluded.push({
          name: row.name,
          check: checked.check,
          feature: checked.feature,
          source: checked.source,
        });
        continue;
      }
      return fail(checked.error);
    }
    const scored = scoreBaselineModel(input.baseline, {
      version: manifest.modelVersion,
      features: row.features,
    });
    if (!scored.ok) return fail(scored.error);
    included.push({
      name: row.name,
      fold: row.fold,
      regime: row.regime,
      score: scored.score,
      benchmarkNet: row.benchmarkNet,
      label: row.label,
      cost: row.cost,
    });
  }

  let costNote = null;
  for (const row of included) {
    const cost = readExecutionCost(row.cost);
    if (!cost.ok) {
      costNote = cost.error;
      break;
    }
    row.costNet = cost.netReturn;
  }
  if (costNote) return withheld(manifest, checksum, record, included, excluded, costNote);

  for (const row of included) {
    const labeled = labelOutcome(input.labels, {
      version: manifest.labelVersion,
      horizon: manifest.horizon,
      cutoff: row.label.cutoff,
      start: row.label.start,
      outcome: row.label.outcome,
      quality: row.label.quality,
    });
    if (!labeled.ok) return fail(labeled.error);
    const rowNet = addTexts(labeled.return, row.costNet);
    if (rowNet === null) return fail("unsupported field");
    row.rowNet = rowNet;
  }
  return report(manifest, checksum, record, included, excluded, true, null);
}
