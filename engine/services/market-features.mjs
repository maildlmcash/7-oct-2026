// Core market features for TASK 10.A.02.
// Spread is the best ask minus the best bid. Depth imbalance is the design page 8
// OBI ratio. CVD is cumulative taker buy minus taker sell. The source says CVD is
// normalized and names no divisor, so this value is not rescaled.
// VWAP, volatility, and realized range have no formula in the source, so they stay
// missing. Funding, open interest, basis, and liquidation are source values.
// A missing input stays null. It is not stored as zero.
// The event-time watermark is the accepted event time. A sequence at or behind
// the previous sequence is stale. This module does not place orders.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const INPUT_KEYS = Object.freeze([
  "eventTime",
  "sequence",
  "sequenceWatermark",
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
const TRADE_KEYS = Object.freeze(["side", "quantity", "price"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);
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

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function sequenceValue(value) {
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

function eventTimeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
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

function subtract(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const difference = a.n * 10n ** BigInt(scale - a.scale) - b.n * 10n ** BigInt(scale - b.scale);
  if (difference <= 0n) return null;
  return format(difference, scale);
}

function sumDecimals(values) {
  let n = 0n;
  let scale = 0;
  for (const value of values) {
    const parsed = parseDecimal(value);
    if (!parsed) return null;
    const next = Math.max(scale, parsed.scale);
    n = n * 10n ** BigInt(next - scale) + parsed.n * 10n ** BigInt(next - parsed.scale);
    scale = next;
  }
  return { n, scale };
}

function optionalDecimal(value) {
  if (value === undefined || value === null) return { ok: true, present: false };
  if (!decimal(value)) return { ok: false, present: false };
  return { ok: true, present: true, value };
}

function qualityState(value) {
  if (value === undefined || value === null) return { ok: true, missing: true, stale: false, quality: null };
  if (value === "degraded") {
    return { ok: true, missing: false, stale: true, quality: Object.freeze({ healthy: false, reason: "degraded" }) };
  }
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false };
  if (typeof value.healthy !== "boolean") return { ok: false };
  if (value.reason !== null && !filled(value.reason)) return { ok: false };
  const stale = value.healthy !== true || value.reason !== null;
  return {
    ok: true,
    missing: false,
    stale,
    quality: Object.freeze({ healthy: value.healthy, reason: value.reason }),
  };
}

function cvd(trades) {
  if (trades === undefined || trades === null) return null;
  if (!Array.isArray(trades) || trades.length === 0) return null;
  const buys = [];
  const sells = [];
  for (const trade of trades) {
    if (!plainObject(trade) || unknownKey(trade, TRADE_KEYS)) return null;
    if (trade.side !== "buy" && trade.side !== "sell") return null;
    if (!decimal(trade.quantity)) return null;
    if (trade.price !== undefined && !decimal(trade.price)) return null;
    if (trade.side === "buy") buys.push(trade.quantity);
    else sells.push(trade.quantity);
  }
  const buy = sumDecimals(buys);
  const sell = sumDecimals(sells);
  if (!buy || !sell) return null;
  const scale = Math.max(buy.scale, sell.scale);
  const difference = buy.n * 10n ** BigInt(scale - buy.scale) - sell.n * 10n ** BigInt(scale - sell.scale);
  return format(difference, scale);
}

function imbalance(bidDepth, askDepth) {
  const bid = parseDecimal(bidDepth);
  const ask = parseDecimal(askDepth);
  if (!bid || !ask) return null;
  const scale = Math.max(bid.scale, ask.scale);
  const bidN = bid.n * 10n ** BigInt(scale - bid.scale);
  const askN = ask.n * 10n ** BigInt(scale - ask.scale);
  return ratio(bidN - askN, bidN + askN);
}

function sourceOf(input) {
  const funding = optionalDecimal(input.funding);
  const openInterest = optionalDecimal(input.openInterest);
  const basis = optionalDecimal(input.basis);
  const liquidation = optionalDecimal(input.liquidation);
  if (!funding.ok || !openInterest.ok || !basis.ok || !liquidation.ok) return null;
  return {
    spread: subtract(input.askPrice, input.bidPrice),
    "depth imbalance": imbalance(input.bidDepth, input.askDepth),
    CVD: cvd(input.trades),
    VWAP: null,
    volatility: null,
    "realized range": null,
    funding: funding.present ? funding.value : null,
    "open interest": openInterest.present ? openInterest.value : null,
    basis: basis.present ? basis.value : null,
    liquidation: liquidation.present ? liquidation.value : null,
  };
}

function featureList(values, eventTime, watermark, quality) {
  return Object.freeze(FEATURES.map(([name, formula]) => {
    const value = values ? values[name] : null;
    const present = value !== null && value !== undefined;
    return Object.freeze({
      name,
      value: present ? value : null,
      eventTime: present ? eventTime : null,
      inputWatermark: watermark,
      quality,
      formula,
    });
  }));
}

export function readMarketFeatures(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (input.eventTime !== undefined && !eventTimeValue(input.eventTime)) return fail("unsupported field");
  if (input.sequence !== undefined && !sequenceValue(input.sequence)) return fail("unsupported field");
  if (input.sequenceWatermark !== undefined && input.sequenceWatermark !== null && !sequenceValue(input.sequenceWatermark)) {
    return fail("unsupported field");
  }
  const quality = qualityState(input.quality);
  if (!quality.ok) return fail("unsupported field");
  const values = sourceOf(input);
  if (!values) return fail("unsupported field");
  const previousSequence = input.sequenceWatermark === undefined ? null : input.sequenceWatermark;
  const sequenceStale = previousSequence !== null
    && input.sequence !== undefined
    && compareDigits(input.sequence, previousSequence) <= 0;
  const accepted = input.eventTime !== undefined
    && input.sequence !== undefined
    && !quality.missing
    && !quality.stale
    && !sequenceStale;
  if (!accepted) {
    const stale = quality.stale || sequenceStale;
    return Object.freeze({
      ok: true,
      blocked: null,
      stale,
      inputWatermark: null,
      sequenceWatermark: previousSequence,
      features: featureList(null, null, null, stale ? Object.freeze({ healthy: false, reason: "stale stream" }) : null),
    });
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    stale: false,
    inputWatermark: input.eventTime,
    sequenceWatermark: input.sequence,
    features: featureList(values, input.eventTime, input.eventTime, quality.quality),
  });
}
