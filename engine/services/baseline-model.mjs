// Versioned Spot signed baseline for TASK 11.B.01.
// The approved score is the design page 8 linear combination of seven signed components.
// Each component is clipped to the closed interval from -1 to +1.
// The total is clamped to the closed interval from -100 to +100.
// A missing component stays missing and does not become zero.
// Rolling robust z-score parameters are NOT IN SOURCE, so this module does not scale raw features.
// Logistic coefficients and gradient-boosted hyperparameters are NOT IN SOURCE.
// calibratedProbability stays null and is never copied from the raw score.
// Weights are frozen. This module does not place orders and does not calculate a futures score.

const UNSIGNED = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const DECIMAL_VALUE = new RegExp(`^(-?)(${UNSIGNED})$`);
const FRACTION_VALUE = new RegExp(`^(-?)(${UNSIGNED})/(${UNSIGNED})$`);
const REGISTER_KEYS = Object.freeze(["version"]);
const SCORE_KEYS = Object.freeze(["version", "features"]);

export const BASELINE_FEATURES = Object.freeze([
  "OBI",
  "CVD",
  "TradeImbalance",
  "TrendRegime",
  "DEXNetFlow",
  "WhaleVerifiedFlow",
  "CrossVenueBreadth",
]);

export const BASELINE_WEIGHTS = Object.freeze({
  OBI: 22,
  CVD: 20,
  TradeImbalance: 16,
  TrendRegime: 14,
  DEXNetFlow: 12,
  WhaleVerifiedFlow: 10,
  CrossVenueBreadth: 6,
});

export const BASELINE_FORMULA = "100 * (0.22*OBI + 0.20*CVD + 0.16*TradeImbalance + 0.14*TrendRegime + 0.12*DEXNetFlow + 0.10*WhaleVerifiedFlow + 0.06*CrossVenueBreadth)";

function fail(error, modelVersion = null, formula = null) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    modelVersion,
    formula,
    score: null,
    calibratedProbability: null,
  });
}

function succeed(modelVersion, score) {
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    modelVersion,
    formula: BASELINE_FORMULA,
    score,
    calibratedProbability: null,
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
  return Boolean(store) && store.kind === "baseline" && store.versions instanceof Map;
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
  const decimal = DECIMAL_VALUE.exec(value);
  if (!decimal) return { kind: "bad" };
  const negative = decimal[1] === "-";
  const part = parseUnsigned(decimal[2]);
  return {
    kind: "value",
    value: {
      n: negative ? -part.n : part.n,
      d: 10n ** BigInt(part.scale),
    },
  };
}

function clip(part) {
  const magnitude = part.n < 0n ? -part.n : part.n;
  if (magnitude > part.d) return { n: part.n < 0n ? -1n : 1n, d: 1n };
  return part;
}

function addWeighted(sum, weight, part) {
  return {
    n: sum.n * part.d + BigInt(weight) * part.n * sum.d,
    d: sum.d * part.d,
  };
}

function clampRatio(part) {
  const limit = 100n * part.d;
  if (part.n > limit) return "100";
  if (part.n < -limit) return "-100";
  return ratio(part.n, part.d);
}

function scoreFeatures(features, weights) {
  let sum = { n: 0n, d: 1n };
  for (const name of BASELINE_FEATURES) {
    const parsed = parseSigned(features[name]);
    if (parsed.kind === "missing") return { ok: false, error: "signed feature is missing" };
    if (parsed.kind !== "value") return { ok: false, error: "unsupported field" };
    sum = addWeighted(sum, weights[name], clip(parsed.value));
  }
  return { ok: true, score: clampRatio(sum) };
}

export function createBaselineStore() {
  return { kind: "baseline", versions: new Map() };
}

export function registerBaselineModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, REGISTER_KEYS)) return fail("unsupported field");
  if (typeof input.version !== "string") return fail("unsupported field");
  if (!filled(input.version)) return fail("model version is not configured");
  const prior = store.versions.get(input.version);
  if (prior) return succeed(prior.modelVersion, null);
  const record = Object.freeze({
    modelVersion: input.version,
    formula: BASELINE_FORMULA,
    features: BASELINE_FEATURES,
    weights: BASELINE_WEIGHTS,
  });
  store.versions.set(input.version, record);
  return succeed(record.modelVersion, null);
}

export function scoreBaselineModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, SCORE_KEYS)) return fail("unsupported field");
  if (typeof input.version !== "string") return fail("unsupported field");
  if (!filled(input.version)) return fail("model version is not configured");
  const record = store.versions.get(input.version);
  if (!record) return fail("model version is not configured", input.version);
  if (!plainObject(input.features) || unknownKey(input.features, BASELINE_FEATURES)) {
    return fail("unsupported field", record.modelVersion, record.formula);
  }
  const scored = scoreFeatures(input.features, record.weights);
  if (!scored.ok) return fail(scored.error, record.modelVersion, record.formula);
  return succeed(record.modelVersion, scored.score);
}
