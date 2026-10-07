// Model health charts for TASK 10.B.02.
// Design page 8 names predicted probability buckets versus observed outcome,
// a Brier score, and a reliability curve. It also names log loss. It does not
// write the Brier or log-loss arithmetic, a bucket count, or a minimum sample size.
// This module bins only when the caller supplies edges that partition 0 through 1.
// A bin below the caller-supplied minimum sample size is marked insufficient and
// has no reliability rate. Brier, log loss, and drift are not calculated.
// The source names no pixel breakpoint, so every width uses one column.
// Outcomes stay "0" or "1". This chart does not guarantee a direction.
// This module does not place orders and does not open a network connection.

const UNSIGNED = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;

export const MODEL_HEALTH_VIEWS = Object.freeze([
  "calibration",
  "brier/log-loss",
  "drift",
  "feature freshness",
  "feed gaps",
  "model/data version",
]);

const CALIBRATION_KEYS = Object.freeze(["view", "observations", "edges", "minimumSampleSize"]);
const HISTORY_KEYS = Object.freeze(["view", "bound", "from", "to", "points", "stale", "quality", "minimumSampleSize"]);
const FRESHNESS_KEYS = Object.freeze(["view", "features", "minimumSampleSize"]);
const GAP_KEYS = Object.freeze(["view", "gaps", "minimumSampleSize"]);
const VERSION_KEYS = Object.freeze([
  "view",
  "modelVersion",
  "dataVersion",
  "featureVersion",
  "from",
  "to",
  "sampleSize",
  "minimumSampleSize",
]);
const OBSERVATION_KEYS = Object.freeze(["eventTime", "probability", "outcome"]);
const BRIER_KEYS = Object.freeze(["eventTime", "brier", "logLoss"]);
const DRIFT_KEYS = Object.freeze(["eventTime", "value"]);
const FEATURE_KEYS = Object.freeze(["name", "watermark", "observedAt", "threshold"]);
const GAP_RECORD_KEYS = Object.freeze(["from", "to", "reason"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);
const LAYOUT_KEYS = Object.freeze(["width"]);

export const MODEL_HEALTH_LAYOUT = Object.freeze({
  columns: 1,
  stack: "column",
  maxWidth: "100%",
  wrap: true,
});

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    direction: null,
    guaranteesDirection: false,
    status: "insufficient",
    sampleSize: null,
    observedWindow: null,
    bins: Object.freeze([]),
    points: Object.freeze([]),
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

function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function eventTimeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeDigits(value) {
  return typeof value === "number" ? String(value) : value;
}

function compareTime(left, right) {
  const a = timeDigits(left);
  const b = timeDigits(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function decimal(value) {
  return typeof value === "string" && UNSIGNED.test(value);
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function format(n, scale) {
  let digits = n.toString();
  if (scale > 0) {
    if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
    const cut = digits.length - scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  return digits === "0" ? "0" : digits;
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
  if (rest !== 1n) return `${num.toString()}/${den.toString()}`;
  const scale = twos > fives ? twos : fives;
  const scaled = num * 2n ** (scale - twos) * 5n ** (scale - fives);
  return format(scaled, Number(scale));
}

function compareDecimal(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.n * 10n ** BigInt(scale - a.scale);
  const bv = b.n * 10n ** BigInt(scale - b.scale);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function probability(value) {
  const parsed = parseDecimal(value);
  if (!parsed) return false;
  return parsed.n <= 10n ** BigInt(parsed.scale);
}

function minimumOf(value) {
  if (value === undefined || value === null) return { ok: true, configured: false, value: null };
  if (!positive(value)) return { ok: false };
  return { ok: true, configured: true, value };
}

function qualityState(value) {
  if (value === undefined || value === null) return { ok: true, stale: false, quality: null };
  if (value === "degraded") {
    return { ok: true, stale: true, quality: Object.freeze({ healthy: false, reason: "degraded" }) };
  }
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false };
  if (typeof value.healthy !== "boolean") return { ok: false };
  if (value.reason !== null && !filled(value.reason)) return { ok: false };
  const stale = value.healthy !== true || value.reason !== null;
  return { ok: true, stale, quality: Object.freeze({ healthy: value.healthy, reason: value.reason }) };
}

function windowOf(times) {
  if (times.length === 0) return null;
  let from = times[0];
  let to = times[0];
  for (const time of times) {
    if (compareTime(time, from) < 0) from = time;
    if (compareTime(time, to) > 0) to = time;
  }
  return Object.freeze({ from, to });
}

function result(fields) {
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    view: fields.view,
    direction: null,
    guaranteesDirection: false,
    status: fields.status,
    note: fields.note ?? null,
    formula: fields.formula ?? null,
    sampleSize: fields.sampleSize ?? null,
    minimumSampleSize: fields.minimumSampleSize ?? null,
    observedWindow: fields.observedWindow ?? null,
    truncated: fields.truncated === true,
    bins: Object.freeze((fields.bins ?? []).map((bin) => Object.freeze(bin))),
    points: Object.freeze((fields.points ?? []).map((point) => Object.freeze(point))),
    records: Object.freeze((fields.records ?? []).map((record) => Object.freeze(record))),
    modelVersion: fields.modelVersion ?? null,
    dataVersion: fields.dataVersion ?? null,
    featureVersion: fields.featureVersion ?? null,
    palette: null,
    layout: MODEL_HEALTH_LAYOUT,
    quality: fields.quality ?? null,
  });
}

function chartStatus(sampleSize, minimum, rowsInsufficient) {
  if (!minimum.configured || sampleSize === null || sampleSize < minimum.value || rowsInsufficient) {
    return "insufficient";
  }
  return "sufficient";
}

function meanOf(values) {
  if (values.length === 0) return null;
  let scale = 0;
  let n = 0n;
  for (const value of values) {
    const parsed = parseDecimal(value);
    const next = Math.max(scale, parsed.scale);
    n = n * 10n ** BigInt(next - scale) + parsed.n * 10n ** BigInt(next - parsed.scale);
    scale = next;
  }
  return ratio(n, BigInt(values.length) * 10n ** BigInt(scale));
}

function edgesOf(edges) {
  if (edges === undefined || edges === null) return { ok: true, configured: false, edges: null };
  if (!Array.isArray(edges) || edges.length < 2) return { ok: false };
  for (let index = 0; index < edges.length; index += 1) {
    if (!probability(edges[index])) return { ok: false };
    if (index > 0 && compareDecimal(edges[index - 1], edges[index]) >= 0) return { ok: false };
  }
  if (compareDecimal(edges[0], "0") !== 0 || compareDecimal(edges[edges.length - 1], "1") !== 0) return { ok: false };
  return { ok: true, configured: true, edges };
}

function observationsOf(observations) {
  if (observations === undefined) return { ok: true, rows: [] };
  if (!Array.isArray(observations)) return { ok: false };
  const rows = [];
  for (const row of observations) {
    if (!plainObject(row) || unknownKey(row, OBSERVATION_KEYS)) return { ok: false };
    if (!eventTimeValue(row.eventTime) || !probability(row.probability)) return { ok: false };
    if (row.outcome !== "0" && row.outcome !== "1") return { ok: false };
    rows.push(row);
  }
  return { ok: true, rows };
}

function binFor(probabilityValue, edges) {
  const last = edges.length - 2;
  for (let index = 0; index < last; index += 1) {
    if (compareDecimal(probabilityValue, edges[index]) >= 0 && compareDecimal(probabilityValue, edges[index + 1]) < 0) {
      return index;
    }
  }
  if (compareDecimal(probabilityValue, edges[last]) >= 0 && compareDecimal(probabilityValue, edges[last + 1]) <= 0) {
    return last;
  }
  return -1;
}

function calibration(input, minimum) {
  const observations = observationsOf(input.observations);
  if (!observations.ok) return fail("unsupported field");
  const edges = edgesOf(input.edges);
  if (!edges.ok) return fail("unsupported field");
  const observedWindow = windowOf(observations.rows.map((row) => row.eventTime));
  if (!edges.configured) {
    return result({
      view: input.view,
      status: "insufficient",
      note: "bins are not configured",
      formula: "predicted probability buckets vs observed outcome",
      sampleSize: observations.rows.length,
      minimumSampleSize: minimum.value,
      observedWindow,
    });
  }
  const groups = edges.edges.slice(0, -1).map(() => []);
  for (const row of observations.rows) {
    const index = binFor(row.probability, edges.edges);
    if (index < 0) return fail("unsupported field");
    groups[index].push(row);
  }
  let rowsInsufficient = !minimum.configured || observations.rows.length < (minimum.value ?? 0);
  const bins = groups.map((group, index) => {
    const count = group.length;
    const lowSample = !minimum.configured || count < minimum.value;
    if (lowSample) rowsInsufficient = true;
    const outcomeCount = group.reduce((sum, row) => sum + (row.outcome === "1" ? 1 : 0), 0);
    return {
      low: edges.edges[index],
      high: edges.edges[index + 1],
      count,
      outcomeCount: lowSample ? null : outcomeCount,
      meanPredicted: lowSample ? null : meanOf(group.map((row) => row.probability)),
      observedRate: lowSample ? null : ratio(BigInt(outcomeCount), BigInt(count)),
      status: lowSample ? "insufficient" : "sufficient",
    };
  });
  return result({
    view: input.view,
    status: rowsInsufficient ? "insufficient" : "sufficient",
    note: minimum.configured ? null : "sample size is not configured",
    formula: "predicted probability buckets vs observed outcome",
    sampleSize: observations.rows.length,
    minimumSampleSize: minimum.value,
    observedWindow,
    bins,
  });
}

function optionalDecimal(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!decimal(value)) return { ok: false };
  return { ok: true, value };
}

function historyPoints(view, points) {
  if (points === undefined) return { ok: true, rows: [] };
  if (!Array.isArray(points)) return { ok: false };
  const rows = [];
  for (const point of points) {
    const keys = view === "drift" ? DRIFT_KEYS : BRIER_KEYS;
    if (!plainObject(point) || unknownKey(point, keys) || !eventTimeValue(point.eventTime)) return { ok: false };
    if (view === "drift") {
      const value = optionalDecimal(point.value);
      if (!value.ok) return { ok: false };
      rows.push({ eventTime: point.eventTime, value: value.value });
    } else {
      const brier = optionalDecimal(point.brier);
      const logLoss = optionalDecimal(point.logLoss);
      if (!brier.ok || !logLoss.ok) return { ok: false };
      rows.push({ eventTime: point.eventTime, brier: brier.value, logLoss: logLoss.value });
    }
  }
  return { ok: true, rows };
}

function history(input, minimum) {
  if (!positive(input.bound)) return fail("bound is required");
  if (input.stale !== undefined && typeof input.stale !== "boolean") return fail("unsupported field");
  const quality = qualityState(input.quality);
  if (!quality.ok) return fail("unsupported field");
  const hasFrom = input.from !== undefined && input.from !== null;
  const hasTo = input.to !== undefined && input.to !== null;
  if (hasFrom !== hasTo) return fail("unsupported field");
  if (hasFrom && (!eventTimeValue(input.from) || !eventTimeValue(input.to))) return fail("unsupported field");
  if (hasFrom && compareTime(input.from, input.to) > 0) return fail("unsupported field");
  const parsed = historyPoints(input.view, input.points);
  if (!parsed.ok) return fail("unsupported field");
  const stale = input.stale === true || quality.stale;
  if (stale) {
    const reason = quality.quality && quality.quality.reason ? quality.quality.reason : "stale stream";
    return result({
      view: input.view,
      status: "insufficient",
      formula: "NOT IN SOURCE",
      sampleSize: 0,
      minimumSampleSize: minimum.value,
      note: minimum.configured ? null : "sample size is not configured",
      quality: Object.freeze({ healthy: false, reason }),
    });
  }
  const included = hasFrom
    ? parsed.rows.filter((row) => compareTime(row.eventTime, input.from) >= 0 && compareTime(row.eventTime, input.to) <= 0)
    : parsed.rows;
  const ordered = included.map((row, index) => ({ row, index })).sort((left, right) => {
    const order = compareTime(left.row.eventTime, right.row.eventTime);
    return order === 0 ? left.index - right.index : order;
  });
  const plotted = ordered.slice(0, input.bound).map((item) => item.row);
  const sampleSize = included.length;
  return result({
    view: input.view,
    status: chartStatus(sampleSize, minimum, false),
    formula: "NOT IN SOURCE",
    sampleSize,
    minimumSampleSize: minimum.value,
    observedWindow: windowOf(included.map((row) => row.eventTime)),
    truncated: ordered.length > input.bound,
    points: plotted,
    note: minimum.configured ? null : "sample size is not configured",
  });
}

function ageBetween(later, earlier) {
  return BigInt(timeDigits(later)) - BigInt(timeDigits(earlier));
}

function freshness(input, minimum) {
  if (input.features === undefined) {
    return result({
      view: input.view,
      status: "insufficient",
      note: "feature freshness is not measured",
      sampleSize: 0,
      minimumSampleSize: minimum.value,
    });
  }
  if (!Array.isArray(input.features)) return fail("unsupported field");
  const records = [];
  for (const feature of input.features) {
    if (!plainObject(feature) || unknownKey(feature, FEATURE_KEYS) || !filled(feature.name)) return fail("unsupported field");
    if (!eventTimeValue(feature.watermark) || !eventTimeValue(feature.observedAt)) return fail("unsupported field");
    if (feature.threshold !== undefined && feature.threshold !== null && !eventTimeValue(feature.threshold)) {
      return fail("unsupported field");
    }
    const age = ageBetween(feature.observedAt, feature.watermark);
    const thresholdMissing = feature.threshold === undefined || feature.threshold === null;
    let status = "insufficient";
    if (!thresholdMissing) {
      const limit = BigInt(timeDigits(feature.threshold));
      status = age < 0n || age > limit ? "stale" : "recorded";
    }
    records.push({
      name: feature.name,
      watermark: feature.watermark,
      observedAt: feature.observedAt,
      age: age.toString(),
      threshold: thresholdMissing ? null : feature.threshold,
      status,
    });
  }
  const low = !minimum.configured || records.length < minimum.value || records.some((record) => record.status !== "recorded");
  return result({
    view: input.view,
    status: low ? "insufficient" : "sufficient",
    note: records.some((record) => record.threshold === null) ? "freshness threshold is not configured" : null,
    sampleSize: records.length,
    minimumSampleSize: minimum.value,
    observedWindow: windowOf(records.map((record) => record.observedAt)),
    records,
  });
}

function gaps(input, minimum) {
  if (input.gaps === undefined) {
    return result({
      view: input.view,
      status: "insufficient",
      note: "feed gaps are not measured",
      sampleSize: 0,
      minimumSampleSize: minimum.value,
    });
  }
  if (!Array.isArray(input.gaps)) return fail("unsupported field");
  const records = [];
  for (const gap of input.gaps) {
    if (!plainObject(gap) || unknownKey(gap, GAP_RECORD_KEYS)) return fail("unsupported field");
    if (!eventTimeValue(gap.from) || !eventTimeValue(gap.to) || !filled(gap.reason)) return fail("unsupported field");
    if (compareTime(gap.from, gap.to) > 0) return fail("unsupported field");
    records.push({ from: gap.from, to: gap.to, reason: gap.reason });
  }
  return result({
    view: input.view,
    status: chartStatus(records.length, minimum, records.length === 0),
    note: records.length === 0 ? "gap records are empty" : (minimum.configured ? null : "sample size is not configured"),
    sampleSize: records.length,
    minimumSampleSize: minimum.value,
    observedWindow: records.length === 0 ? null : windowOf(records.flatMap((record) => [record.from, record.to])),
    records,
  });
}

function versions(input, minimum) {
  if (input.modelVersion !== undefined && !filled(input.modelVersion)) return fail("unsupported field");
  if (input.dataVersion !== undefined && !filled(input.dataVersion)) return fail("unsupported field");
  if (input.featureVersion !== undefined && input.featureVersion !== null && !filled(input.featureVersion)) {
    return fail("unsupported field");
  }
  const hasFrom = input.from !== undefined && input.from !== null;
  const hasTo = input.to !== undefined && input.to !== null;
  if (hasFrom !== hasTo) return fail("unsupported field");
  if (hasFrom && (!eventTimeValue(input.from) || !eventTimeValue(input.to) || compareTime(input.from, input.to) > 0)) {
    return fail("unsupported field");
  }
  if (input.sampleSize !== undefined && input.sampleSize !== null) {
    if (typeof input.sampleSize !== "number" || !Number.isSafeInteger(input.sampleSize) || input.sampleSize < 0) {
      return fail("unsupported field");
    }
  }
  const modelVersion = filled(input.modelVersion) ? input.modelVersion : null;
  const dataVersion = filled(input.dataVersion) ? input.dataVersion : null;
  let note = null;
  if (!modelVersion) note = "model version is not configured";
  else if (!dataVersion) note = "data version is not configured";
  else if (!minimum.configured || input.sampleSize === undefined || input.sampleSize === null) note = "sample size is not configured";
  const sampleSize = typeof input.sampleSize === "number" ? input.sampleSize : null;
  const low = note !== null || sampleSize === null || !minimum.configured || sampleSize < minimum.value;
  return result({
    view: input.view,
    status: low ? "insufficient" : "sufficient",
    note,
    sampleSize,
    minimumSampleSize: minimum.value,
    observedWindow: hasFrom ? Object.freeze({ from: input.from, to: input.to }) : null,
    modelVersion,
    dataVersion,
    featureVersion: filled(input.featureVersion) ? input.featureVersion : null,
  });
}

export function modelHealthLayout(input) {
  const source = input === undefined ? {} : input;
  if (!plainObject(source) || unknownKey(source, LAYOUT_KEYS)) return fail("unsupported field");
  if (source.width !== undefined && !positive(source.width)) return fail("unsupported field");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    columns: MODEL_HEALTH_LAYOUT.columns,
    stack: MODEL_HEALTH_LAYOUT.stack,
    maxWidth: MODEL_HEALTH_LAYOUT.maxWidth,
    wrap: MODEL_HEALTH_LAYOUT.wrap,
    width: source.width === undefined ? null : source.width,
    direction: null,
    guaranteesDirection: false,
  });
}

export function readModelHealthChart(input) {
  if (!plainObject(input) || input.view === undefined || input.view === null || input.view === "") {
    return fail(input && plainObject(input) && input.view !== undefined ? "unsupported field" : "view is required");
  }
  if (!MODEL_HEALTH_VIEWS.includes(input.view)) return fail("unsupported field");
  const allowed = input.view === "calibration"
    ? CALIBRATION_KEYS
    : input.view === "feature freshness"
      ? FRESHNESS_KEYS
      : input.view === "feed gaps"
        ? GAP_KEYS
        : input.view === "model/data version"
          ? VERSION_KEYS
          : HISTORY_KEYS;
  if (unknownKey(input, allowed)) return fail("unsupported field");
  const minimum = minimumOf(input.minimumSampleSize);
  if (!minimum.ok) return fail("unsupported field");
  if (input.view === "calibration") return calibration(input, minimum);
  if (input.view === "feature freshness") return freshness(input, minimum);
  if (input.view === "feed gaps") return gaps(input, minimum);
  if (input.view === "model/data version") return versions(input, minimum);
  return history(input, minimum);
}
