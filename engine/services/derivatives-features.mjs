// Derivatives features for TASK 12.A.02.
// Funding, open interest, and basis stay caller source values. The source names
// no basis divisor, so basis is not derived from mark or index.
// Mark/index divergence is mark minus index. The source names no divisor.
// Liquidation events sum their quantities. Position mode is hedge or one-way.
// Each supplied input carries its source timestamp and quality flag.
// An unhealthy flag withholds that value. Funding does not set a direction.
// This module does not calculate a futures score and does not place orders.

import { readContract } from "./contract-specs.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const MODES = new Set(["hedge", "one-way"]);
const INPUT_KEYS = Object.freeze([
  "contractId",
  "funding",
  "openInterest",
  "basis",
  "mark",
  "index",
  "liquidations",
  "positionMode",
]);
const MEASURE_KEYS = Object.freeze(["value", "eventTime", "quality"]);
const EVENT_KEYS = Object.freeze(["quantity", "eventTime", "quality"]);
const MODE_KEYS = Object.freeze(["mode", "eventTime", "quality"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);

export const DERIVATIVES_DIRECTION = "funding alone never determines direction";
export const POSITION_MODES = Object.freeze(["hedge", "one-way"]);
export const DIVERGENCE_FORMULA = "mark minus index";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    direction: null,
    directionRule: DERIVATIVES_DIRECTION,
    features: null,
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

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function eventTimeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function sequenceDigits(value) {
  return typeof value === "number" ? String(value) : value;
}

function compareDigits(left, right) {
  const a = sequenceDigits(left);
  const b = sequenceDigits(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function earlier(left, right) {
  return compareDigits(left, right) <= 0 ? left : right;
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function parseSigned(value) {
  if (typeof value !== "string") return null;
  const negative = value.startsWith("-");
  const parsed = parseDecimal(negative ? value.slice(1) : value);
  if (!parsed) return null;
  return { n: negative ? -parsed.n : parsed.n, scale: parsed.scale };
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

function blank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function qualityState(value) {
  if (value === undefined || value === null) return { ok: false, error: "quality is not configured" };
  if (value === "degraded") {
    return { ok: true, quality: Object.freeze({ healthy: false, reason: "degraded" }) };
  }
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false, error: "unsupported field" };
  if (typeof value.healthy !== "boolean") return { ok: false, error: "unsupported field" };
  if (value.reason !== null && !filled(value.reason)) return { ok: false, error: "unsupported field" };
  return { ok: true, quality: Object.freeze({ healthy: value.healthy, reason: value.reason }) };
}

function timestamp(value) {
  if (blank(value)) return { ok: false, error: "source timestamp is not configured" };
  if (!eventTimeValue(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

function signedMeasure(value, missing) {
  if (blank(value)) return { ok: false, error: missing };
  const parsed = parseSigned(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  return { ok: true, text: format(parsed.n, parsed.scale), parsed };
}

function positiveMeasure(value, missing, signError) {
  const measured = signedMeasure(value, missing);
  if (!measured.ok) return measured;
  if (measured.parsed.n < 0n) return { ok: false, error: signError };
  if (measured.parsed.n === 0n) return { ok: false, error: missing };
  return measured;
}

function nonNegativeMeasure(value, missing, signError) {
  const measured = signedMeasure(value, missing);
  if (!measured.ok) return measured;
  if (measured.parsed.n < 0n) return { ok: false, error: signError };
  return measured;
}

function readMeasure(source, parse) {
  if (source === undefined || source === null) return { ok: true, absent: true };
  if (!plainObject(source) || unknownKey(source, MEASURE_KEYS)) return { ok: false, error: "unsupported field" };
  const quality = qualityState(source.quality);
  if (!quality.ok) return quality;
  const time = timestamp(source.eventTime);
  if (!time.ok) return time;
  const measured = parse(source.value);
  if (!measured.ok) return measured;
  const publish = quality.quality.healthy === true && quality.quality.reason === null;
  return {
    ok: true,
    absent: false,
    publish,
    text: publish ? measured.text : null,
    parsed: publish ? measured.parsed : null,
    eventTime: time.value,
    quality: quality.quality,
  };
}

function readMode(source) {
  if (source === undefined || source === null) return { ok: true, absent: true };
  if (!plainObject(source) || unknownKey(source, MODE_KEYS)) return { ok: false, error: "unsupported field" };
  const quality = qualityState(source.quality);
  if (!quality.ok) return quality;
  const time = timestamp(source.eventTime);
  if (!time.ok) return time;
  if (blank(source.mode)) return { ok: false, error: "position mode is not configured" };
  if (typeof source.mode !== "string") return { ok: false, error: "unsupported field" };
  if (!MODES.has(source.mode)) return { ok: false, error: "position mode is not supported" };
  const publish = quality.quality.healthy === true && quality.quality.reason === null;
  return {
    ok: true,
    absent: false,
    publish,
    text: publish ? source.mode : null,
    eventTime: time.value,
    quality: quality.quality,
  };
}

function readLiquidations(source) {
  if (source === undefined || source === null) return { ok: true, absent: true };
  if (!Array.isArray(source)) return { ok: false, error: "unsupported field" };
  if (source.length === 0) return { ok: true, absent: true };
  const events = [];
  for (const event of source) {
    if (!plainObject(event) || unknownKey(event, EVENT_KEYS)) return { ok: false, error: "unsupported field" };
    const quality = qualityState(event.quality);
    if (!quality.ok) return quality;
    const time = timestamp(event.eventTime);
    if (!time.ok) return time;
    const quantity = positiveMeasure(event.quantity, "liquidation is not configured", "liquidation sign is not allowed");
    if (!quantity.ok) return quantity;
    events.push({
      publish: quality.quality.healthy === true && quality.quality.reason === null,
      parsed: quantity.parsed,
      eventTime: time.value,
      quality: quality.quality,
    });
  }
  const publish = events.every((event) => event.publish);
  let eventTime = events[0].eventTime;
  let quality = events[0].quality;
  for (const event of events) {
    eventTime = earlier(eventTime, event.eventTime);
    if (event.quality.healthy !== true || event.quality.reason !== null) quality = event.quality;
  }
  if (!publish) {
    return { ok: true, absent: false, publish: false, text: null, eventTime, quality };
  }
  let n = 0n;
  let scale = 0;
  for (const event of events) {
    const next = Math.max(scale, event.parsed.scale);
    n = n * 10n ** BigInt(next - scale) + event.parsed.n * 10n ** BigInt(next - event.parsed.scale);
    scale = next;
  }
  return {
    ok: true,
    absent: false,
    publish: true,
    text: format(n, scale),
    eventTime,
    quality: Object.freeze({ healthy: true, reason: null }),
  };
}

function difference(mark, index) {
  const scale = Math.max(mark.scale, index.scale);
  const markN = mark.n * 10n ** BigInt(scale - mark.scale);
  const indexN = index.n * 10n ** BigInt(scale - index.scale);
  return format(markN - indexN, scale);
}

function row(name, value, unit, eventTime, quality, formula, extra) {
  return Object.freeze({
    name,
    value,
    unit,
    eventTime,
    quality,
    formula,
    ...extra,
  });
}

function absentRow(name, unit, formula, extra) {
  return row(name, null, unit, null, null, formula, extra);
}

export function readDerivativesFeatures(store, input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const contract = readContract(store, input.contractId);
  if (!contract.ok) return fail(contract.error);
  const funding = readMeasure(input.funding, (value) => signedMeasure(value, "funding is not configured"));
  if (!funding.ok) return fail(funding.error);
  const openInterest = readMeasure(
    input.openInterest,
    (value) => nonNegativeMeasure(value, "open interest is not configured", "open interest sign is not allowed"),
  );
  if (!openInterest.ok) return fail(openInterest.error);
  const basis = readMeasure(input.basis, (value) => signedMeasure(value, "basis is not configured"));
  if (!basis.ok) return fail(basis.error);
  const mark = readMeasure(
    input.mark,
    (value) => positiveMeasure(value, "price is not configured", "price sign is not allowed"),
  );
  if (!mark.ok) return fail(mark.error);
  const index = readMeasure(
    input.index,
    (value) => positiveMeasure(value, "price is not configured", "price sign is not allowed"),
  );
  if (!index.ok) return fail(index.error);
  const liquidations = readLiquidations(input.liquidations);
  if (!liquidations.ok) return fail(liquidations.error);
  const positionMode = readMode(input.positionMode);
  if (!positionMode.ok) return fail(positionMode.error);

  const quantityUnit = contract.units.quantity;
  const priceUnit = contract.units.price;
  let divergence = absentRow("mark/index divergence", priceUnit, DIVERGENCE_FORMULA, {
    markEventTime: null,
    indexEventTime: null,
  });
  if (!mark.absent || !index.absent) {
    const publish = !mark.absent && !index.absent && mark.publish && index.publish;
    let quality = null;
    if (publish) quality = Object.freeze({ healthy: true, reason: null });
    else if (!mark.absent && !mark.publish) quality = mark.quality;
    else if (!index.absent && !index.publish) quality = index.quality;
    divergence = row(
      "mark/index divergence",
      publish ? difference(mark.parsed, index.parsed) : null,
      priceUnit,
      !mark.absent && !index.absent ? earlier(mark.eventTime, index.eventTime) : null,
      quality,
      DIVERGENCE_FORMULA,
      {
        markEventTime: mark.absent ? null : mark.eventTime,
        indexEventTime: index.absent ? null : index.eventTime,
      },
    );
  }

  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    direction: null,
    directionRule: DERIVATIVES_DIRECTION,
    features: Object.freeze([
      funding.absent
        ? absentRow("funding", "funding rate", "source value")
        : row("funding", funding.text, "funding rate", funding.eventTime, funding.quality, "source value"),
      openInterest.absent
        ? absentRow("open interest", quantityUnit, "source value")
        : row("open interest", openInterest.text, quantityUnit, openInterest.eventTime, openInterest.quality, "source value"),
      basis.absent
        ? absentRow("basis", "source value", "source value")
        : row("basis", basis.text, "source value", basis.eventTime, basis.quality, "source value"),
      divergence,
      liquidations.absent
        ? absentRow("liquidation", quantityUnit, "sum of liquidation quantity")
        : row("liquidation", liquidations.text, quantityUnit, liquidations.eventTime, liquidations.quality, "sum of liquidation quantity"),
      positionMode.absent
        ? absentRow("position mode", null, "hedge or one-way")
        : row("position mode", positionMode.text, null, positionMode.eventTime, positionMode.quality, "hedge or one-way"),
    ]),
  });
}
