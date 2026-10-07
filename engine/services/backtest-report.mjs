// Backtest performance report for TASK 13.B.02.
// Every supplied window stays in the report. A negative window is not removed.
// Benchmark and benchmark difference use the existing walk-forward definitions.
// Cost sensitivity is the supplied execution-cost return. A cost shock is NOT IN SOURCE.
// Drawdown, turnover, exposure, win/loss, and uncertainty have no arithmetic in the source.
// Every figure cites the dataset, model, and feature version. This module does not place an order.

import { createHash } from "node:crypto";
import { EXECUTION_NET_RETURN } from "./execution-costs.mjs";
import {
  WALK_FORWARD_BENCHMARK,
  WALK_FORWARD_BENCHMARK_DIFFERENCE,
  WALK_FORWARD_CALIBRATION,
  WALK_FORWARD_DRAWDOWN,
  WALK_FORWARD_UNCERTAINTY,
} from "./walk-forward.mjs";

const NUMBER = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const FRACTION = new RegExp(`^(-?)(${NUMBER})(?:/(${NUMBER}))?$`);
const CHECKSUM = /^[0-9a-f]{64}$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze(["manifest", "windows"]);
const MANIFEST_KEYS = Object.freeze(["datasetId", "modelVersion", "featureVersion", "checksum"]);
const WINDOW_KEYS = Object.freeze(["name", "netReturn", "benchmarkNet", "costReturn", "regime"]);
const NET_FORMULA = "sum of supplied window nets";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    trace: null,
    sampleSize: null,
    netReturn: null,
    benchmark: null,
    benchmarkDifference: null,
    costSensitivity: null,
    windows: null,
    regimes: null,
    drawdown: null,
    turnover: null,
    exposure: null,
    calibration: null,
    winLoss: null,
    uncertainty: null,
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
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseSigned(value) {
  if (typeof value !== "string") return null;
  const match = FRACTION.exec(value);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const [whole, frac = ""] = match[2].split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  const numerator = BigInt(digits);
  const scale = frac.length;
  const denominator = match[3] === undefined ? 10n ** BigInt(scale) : BigInt(match[3]);
  if (denominator === 0n) return null;
  return { n: sign * numerator, d: denominator };
}

function signed(value, missing) {
  if (value === undefined || value === null || value === "") return { ok: false, error: missing };
  const parsed = parseSigned(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  return { ok: true, value: parsed, text: value };
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

function formatRatio(part) {
  const divisor = gcd(part.n, part.d);
  const n = part.n / divisor;
  const d = part.d / divisor;
  if (d === 1n) return n.toString();
  return `${n.toString()}/${d.toString()}`;
}

function add(left, right) {
  return { n: left.n * right.d + right.n * left.d, d: left.d * right.d };
}

function subtract(left, right) {
  return { n: left.n * right.d - right.n * left.d, d: left.d * right.d };
}

function figure(value, formula, trace) {
  return Object.freeze({ value, formula, trace });
}

export function checksumBacktestReport(input) {
  if (!plainObject(input) || !Array.isArray(input.windows)) return null;
  const body = {
    datasetId: input.datasetId,
    modelVersion: input.modelVersion,
    featureVersion: input.featureVersion,
    windows: input.windows,
  };
  return createHash("sha256").update(canonical(body)).digest("hex");
}

export function reportBacktestPerformance(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (!plainObject(input.manifest) || unknownKey(input.manifest, MANIFEST_KEYS)) return fail("manifest is not configured");
  const datasetId = named(input.manifest.datasetId, "dataset is not configured");
  if (!datasetId.ok) return fail(datasetId.error);
  const modelVersion = named(input.manifest.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return fail(modelVersion.error);
  const featureVersion = named(input.manifest.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return fail(featureVersion.error);
  if (typeof input.manifest.checksum !== "string" || !CHECKSUM.test(input.manifest.checksum)) {
    return fail("manifest checksum is not configured");
  }
  if (!Array.isArray(input.windows) || input.windows.length === 0) return fail("sample is not configured");
  const windows = [];
  let total = { n: 0n, d: 1n };
  let benchmark = { n: 0n, d: 1n };
  let cost = { n: 0n, d: 1n };
  for (const window of input.windows) {
    if (!plainObject(window) || unknownKey(window, WINDOW_KEYS)) return fail("unsupported field");
    if (!filled(window.name)) return fail("window is not configured");
    if (!filled(window.regime)) return fail("regime is not configured");
    const net = signed(window.netReturn, "net return is not configured");
    if (!net.ok) return fail(net.error);
    const mark = signed(window.benchmarkNet, "benchmark is not configured");
    if (!mark.ok) return fail(mark.error);
    const spent = signed(window.costReturn, "cost sensitivity is not configured");
    if (!spent.ok) return fail(spent.error);
    total = add(total, net.value);
    benchmark = add(benchmark, mark.value);
    cost = add(cost, spent.value);
    windows.push(Object.freeze({
      name: window.name,
      netReturn: window.netReturn,
      benchmarkNet: window.benchmarkNet,
      costReturn: window.costReturn,
      regime: window.regime,
    }));
  }
  const checksum = checksumBacktestReport({
    datasetId: datasetId.value,
    modelVersion: modelVersion.value,
    featureVersion: featureVersion.value,
    windows,
  });
  if (checksum !== input.manifest.checksum) return fail("manifest checksum does not match");
  const trace = Object.freeze({
    datasetId: datasetId.value,
    modelVersion: modelVersion.value,
    featureVersion: featureVersion.value,
    checksum,
  });
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    trace,
    sampleSize: Object.freeze({ value: windows.length, trace }),
    netReturn: figure(formatRatio(total), NET_FORMULA, trace),
    benchmark: figure(formatRatio(benchmark), WALK_FORWARD_BENCHMARK, trace),
    benchmarkDifference: figure(formatRatio(subtract(total, benchmark)), WALK_FORWARD_BENCHMARK_DIFFERENCE, trace),
    costSensitivity: Object.freeze({
      value: formatRatio(cost),
      formula: EXECUTION_NET_RETURN,
      assumption: "a cost shock is NOT IN SOURCE",
      trace,
    }),
    windows: Object.freeze(windows),
    regimes: Object.freeze(windows.map((window) => window.regime)),
    drawdown: figure(null, WALK_FORWARD_DRAWDOWN, trace),
    turnover: figure(null, "NOT IN SOURCE", trace),
    exposure: figure(null, "NOT IN SOURCE", trace),
    calibration: figure(null, WALK_FORWARD_CALIBRATION, trace),
    winLoss: figure(null, "NOT IN SOURCE", trace),
    uncertainty: figure(null, WALK_FORWARD_UNCERTAINTY, trace),
  });
}
