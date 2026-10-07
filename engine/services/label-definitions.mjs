// Spot label definitions for TASK 11.A.01.
// Design page 11 sets the Spot horizons at 1m, 5m, 15m, and 1h.
// The label is the future mid-price return against a dead zone.
// Execution costs are calculated separately and are not applied to this version.
// The dead-zone width and the observation length are caller-supplied.
// A return inside the dead zone, including the exact boundary, is neutral.
// A stale source is vetoed and is not stored as neutral.
// The test window cannot change a stored label version.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const HORIZON_MS = Object.freeze({
  "1m": 60000n,
  "5m": 300000n,
  "15m": 900000n,
  "1h": 3600000n,
});
const INVALID_REASONS = Object.freeze([
  "stale stream",
  "degraded",
  "sequence gap",
  "clock skew",
  "reorg",
  "unverified",
]);
const DEFINITION_KEYS = Object.freeze([
  "version",
  "horizons",
  "deadZone",
  "observationWindow",
  "testWindow",
]);
const WINDOW_KEYS = Object.freeze(["from", "to"]);
const LABEL_KEYS = Object.freeze(["version", "horizon", "cutoff", "start", "outcome", "quality"]);
const PRICE_KEYS = Object.freeze(["bid", "ask", "time"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);

export const SPOT_HORIZONS = Object.freeze(["1m", "5m", "15m", "1h"]);
export const LABEL_TARGET_RETURN = "future mid-price return";

function fail(error, extra) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    vetoed: extra?.vetoed === true,
    label: null,
    return: null,
    version: extra?.version ?? null,
    horizon: extra?.horizon ?? null,
    cutoff: extra?.cutoff ?? null,
    outcomeTime: null,
    deadZone: extra?.deadZone ?? null,
    targetReturn: LABEL_TARGET_RETURN,
    costsApplied: false,
    definition: null,
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

function timeText(value) {
  return timeBig(value).toString();
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

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function storeOf(store) {
  return Boolean(store) && store.versions instanceof Map && store.labels instanceof Map;
}

function windowOf(value) {
  if (value === undefined || value === null) return { ok: false, missing: true };
  if (!plainObject(value) || unknownKey(value, WINDOW_KEYS)) return { ok: false, malformed: true };
  if (!timeValue(value.from) || !timeValue(value.to)) return { ok: false, malformed: true };
  if (timeBig(value.from) >= timeBig(value.to)) return { ok: false, missing: true };
  return Object.freeze({
    ok: true,
    from: timeText(value.from),
    to: timeText(value.to),
  });
}

function overlaps(left, right) {
  return !(timeBig(left.to) < timeBig(right.from) || timeBig(right.to) < timeBig(left.from));
}

function deadZoneOf(value) {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  return format(parsed.n, parsed.scale);
}

function horizonsOf(value) {
  if (!Array.isArray(value) || value.length !== SPOT_HORIZONS.length) return false;
  return SPOT_HORIZONS.every((horizon, index) => value[index] === horizon);
}

function definitionOf(input) {
  if (!plainObject(input) || unknownKey(input, DEFINITION_KEYS) || !filled(input.version)) {
    return { ok: false, error: "label version is not configured" };
  }
  if (input.horizons === undefined || input.horizons === null) {
    return { ok: false, error: "horizon is not configured" };
  }
  if (!Array.isArray(input.horizons)) return { ok: false, error: "unsupported field" };
  if (input.horizons.some((horizon) => !SPOT_HORIZONS.includes(horizon))) {
    return { ok: false, error: "horizon is not supported" };
  }
  if (!horizonsOf(input.horizons)) return { ok: false, error: "horizon is not configured" };
  if (input.deadZone === undefined || input.deadZone === null || input.deadZone === "") {
    return { ok: false, error: "dead zone is not configured" };
  }
  const deadZone = deadZoneOf(input.deadZone);
  if (!deadZone) return { ok: false, error: "unsupported field" };
  const observationWindow = windowOf(input.observationWindow);
  if (!observationWindow.ok) {
    if (observationWindow.malformed) return { ok: false, error: "unsupported field" };
    return { ok: false, error: "observation window is not configured" };
  }
  const testWindow = windowOf(input.testWindow);
  if (!testWindow.ok) {
    if (testWindow.malformed) return { ok: false, error: "unsupported field" };
    return { ok: false, error: "test window is not configured" };
  }
  const definition = Object.freeze({
    version: input.version,
    horizons: SPOT_HORIZONS,
    deadZone,
    targetReturn: LABEL_TARGET_RETURN,
    observationWindow: Object.freeze({ from: observationWindow.from, to: observationWindow.to }),
    testWindow: Object.freeze({ from: testWindow.from, to: testWindow.to }),
    cutoff: observationWindow.to,
    costsApplied: false,
  });
  return { ok: true, definition, checksum: canonical(definition) };
}

function qualityError(value) {
  if (value === undefined || value === null) return { error: "source quality is not configured", vetoed: true };
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

function priceSum(value) {
  if (!plainObject(value) || unknownKey(value, PRICE_KEYS)) return { malformed: true };
  if (!timeValue(value.time)) return { malformed: true };
  const time = timeText(value.time);
  if (value.bid === undefined || value.ask === undefined || value.bid === null || value.ask === null) {
    return { missing: true, time };
  }
  const bid = parseDecimal(value.bid);
  const ask = parseDecimal(value.ask);
  if (!bid || !ask) return { malformed: true };
  const scale = Math.max(bid.scale, ask.scale);
  const bidN = bid.n * 10n ** BigInt(scale - bid.scale);
  const askN = ask.n * 10n ** BigInt(scale - ask.scale);
  if (askN <= bidN) return { missing: true, time };
  return { sum: bidN + askN, scale, time };
}

function alignedSums(start, future) {
  const scale = Math.max(start.scale, future.scale);
  return {
    start: start.sum * 10n ** BigInt(scale - start.scale),
    future: future.sum * 10n ** BigInt(scale - future.scale),
  };
}

function labelClass(numerator, denominator, deadZone) {
  const dead = parseDecimal(deadZone);
  const scale = 10n ** BigInt(dead.scale);
  const left = numerator * scale;
  const right = dead.n * denominator;
  if (left > right) return "rise";
  if (left < -right) return "fall";
  return "neutral";
}

function intervalsOverlap(left, right) {
  return timeBig(left.cutoff) < timeBig(right.outcomeTime)
    && timeBig(right.cutoff) < timeBig(left.outcomeTime);
}

export function createLabelStore() {
  return { versions: new Map(), labels: new Map() };
}

export function registerLabelVersion(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  const built = definitionOf(input);
  if (!built.ok) return fail(built.error);
  const prior = store.versions.get(built.definition.version);
  if (prior) {
    if (prior.checksum === built.checksum) {
      return Object.freeze({
        ok: true,
        blocked: null,
        error: null,
        vetoed: false,
        label: null,
        return: null,
        version: prior.definition.version,
        horizon: null,
        cutoff: prior.definition.cutoff,
        outcomeTime: null,
        deadZone: prior.definition.deadZone,
        targetReturn: LABEL_TARGET_RETURN,
        costsApplied: false,
        definition: prior.definition,
      });
    }
    if (overlaps(built.definition.observationWindow, prior.definition.testWindow)) {
      return fail("test window is not for tuning", {
        version: prior.definition.version,
        deadZone: prior.definition.deadZone,
        cutoff: prior.definition.cutoff,
      });
    }
    return fail("label version is already registered", {
      version: prior.definition.version,
      deadZone: prior.definition.deadZone,
      cutoff: prior.definition.cutoff,
    });
  }
  if (overlaps(built.definition.observationWindow, built.definition.testWindow)) {
    return fail("overlapping window");
  }
  store.versions.set(built.definition.version, Object.freeze({
    checksum: built.checksum,
    definition: built.definition,
  }));
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    vetoed: false,
    label: null,
    return: null,
    version: built.definition.version,
    horizon: null,
    cutoff: built.definition.cutoff,
    outcomeTime: null,
    deadZone: built.definition.deadZone,
    targetReturn: LABEL_TARGET_RETURN,
    costsApplied: false,
    definition: built.definition,
  });
}

export function readLabelVersion(store, input) {
  if (!storeOf(store) || !plainObject(input) || unknownKey(input, ["version"])) return fail("unsupported field");
  if (!filled(input.version)) return fail("label version is not configured");
  const prior = store.versions.get(input.version);
  if (!prior) return fail("label version is not configured");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    vetoed: false,
    label: null,
    return: null,
    version: prior.definition.version,
    horizon: null,
    cutoff: prior.definition.cutoff,
    outcomeTime: null,
    deadZone: prior.definition.deadZone,
    targetReturn: LABEL_TARGET_RETURN,
    costsApplied: false,
    definition: prior.definition,
  });
}

export function labelOutcome(store, input) {
  if (!storeOf(store) || !plainObject(input) || unknownKey(input, LABEL_KEYS)) return fail("unsupported field");
  if (!filled(input.version)) return fail("label version is not configured");
  const prior = store.versions.get(input.version);
  if (!prior) return fail("label version is not configured");
  const definition = prior.definition;
  if (!filled(input.horizon)) return fail("horizon is not configured", { version: definition.version });
  if (!SPOT_HORIZONS.includes(input.horizon)) {
    return fail("horizon is not supported", { version: definition.version });
  }
  if (!timeValue(input.cutoff)) return fail("timestamp is not aligned", { version: definition.version, horizon: input.horizon });
  const cutoff = timeText(input.cutoff);
  const outcomeTime = (timeBig(input.cutoff) + HORIZON_MS[input.horizon]).toString();
  const named = {
    version: definition.version,
    horizon: input.horizon,
    cutoff,
    deadZone: definition.deadZone,
  };
  const start = priceSum(input.start);
  const outcome = priceSum(input.outcome);
  if (start.malformed || outcome.malformed) return fail("unsupported field", named);
  if (!start.time || !outcome.time) return fail("timestamp is not aligned", named);
  if (timeBig(start.time) > timeBig(cutoff)) return fail("lookahead window", named);
  if (start.time !== cutoff || outcome.time !== outcomeTime) return fail("timestamp is not aligned", named);
  const quality = qualityError(input.quality);
  if (quality) return fail(quality.error, { ...named, vetoed: quality.vetoed });
  if (start.missing || outcome.missing) return fail("mid price is missing", named);
  const sums = alignedSums(start, outcome);
  const numerator = sums.future - sums.start;
  const className = labelClass(numerator, sums.start, definition.deadZone);
  const record = Object.freeze({
    version: definition.version,
    horizon: input.horizon,
    cutoff,
    outcomeTime,
    deadZone: definition.deadZone,
    targetReturn: LABEL_TARGET_RETURN,
    return: ratio(numerator, sums.start),
    label: className,
    costsApplied: false,
  });
  const key = `${definition.version}\u0000${input.horizon}\u0000${cutoff}`;
  const stored = store.labels.get(key);
  if (stored) {
    if (canonical(stored) !== canonical(record)) {
      return fail("label is already recorded", named);
    }
  } else {
    for (const other of store.labels.values()) {
      if (other.version === record.version && other.horizon === record.horizon && intervalsOverlap(other, record)) {
        return fail("overlapping window", named);
      }
    }
    store.labels.set(key, record);
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    vetoed: false,
    label: record.label,
    return: record.return,
    version: record.version,
    horizon: record.horizon,
    cutoff: record.cutoff,
    outcomeTime: record.outcomeTime,
    deadZone: record.deadZone,
    targetReturn: record.targetReturn,
    costsApplied: false,
    definition: null,
  });
}
