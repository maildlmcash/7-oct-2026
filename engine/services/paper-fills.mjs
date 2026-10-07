// Depth-aware paper fills for TASK 14.B.01.
// A marketable buy consumes asks from the lowest price. A marketable sell consumes
// bids from the highest price. The levels come from the read-only Spot depth view.
// A book that view marks non-executable produces no fill. lastPrice is not a level.
// The visible remainder of a short book is a partial fill. The round-trip cost walk
// stays in execution-costs and is not reused for that partial.
// The source names no latency model, no latency unit, no limit-order rule, and no
// queue position. A caller latency is recorded and is not applied to price.
// This module does not open a venue client and does not append an order event.

import { readSpotDepthView } from "./spot-depth-view.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INPUT_KEYS = Object.freeze(["status", "levels", "side", "quantity", "feeRate", "latency"]);
const SIDES = Object.freeze(["buy", "sell"]);

export const PAPER_FILL_LIMITATIONS = Object.freeze([
  "latency model is NOT IN SOURCE",
  "latency unit is NOT IN SOURCE",
  "limit order is NOT IN SOURCE",
  "queue position is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    state: null,
    partial: false,
    side: null,
    spread: null,
    levels: null,
    filledQuantity: null,
    unfilledQuantity: null,
    averagePrice: null,
    notional: null,
    fee: null,
    feeRate: null,
    latency: null,
    latencyApplied: false,
    validityTimestamp: null,
    bound: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_FILL_LIMITATIONS,
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

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
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

function comparePrice(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const an = scaleTo(left, scale);
  const bn = scaleTo(right, scale);
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

function decimalField(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  const parsed = parseDecimal(value);
  if (!parsed || parsed.n === 0n) return { ok: false, error: "unsupported field" };
  return { ok: true, value, parsed };
}

function optionalZero(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  const parsed = parseDecimal(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  return { ok: true, value, parsed };
}

function aggregate(rows) {
  const byPrice = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) return null;
    const price = parseDecimal(row[0]);
    const qty = parseDecimal(row[1]);
    if (!price || !qty) return null;
    if (qty.n === 0n) continue;
    const key = format(price.n, price.scale);
    const prior = byPrice.get(key);
    if (!prior) {
      byPrice.set(key, { price, qty });
      continue;
    }
    const scale = Math.max(prior.qty.scale, qty.scale);
    prior.qty = { n: scaleTo(prior.qty, scale) + scaleTo(qty, scale), scale };
  }
  return [...byPrice.values()];
}

function walk(rows, quantity, direction) {
  const levels = aggregate(rows);
  if (!levels) return { ok: false, error: "book is not valid" };
  levels.sort((left, right) => comparePrice(left.price, right.price) * direction);
  let remaining = { n: quantity.n, scale: quantity.scale };
  let filled = { n: 0n, scale: 0 };
  let notional = { n: 0n, scale: 0 };
  const consumed = [];
  for (const level of levels) {
    if (remaining.n === 0n) break;
    const scale = Math.max(remaining.scale, level.qty.scale);
    const need = scaleTo(remaining, scale);
    const have = scaleTo(level.qty, scale);
    const take = need < have ? need : have;
    if (take === 0n) continue;
    const productScale = level.price.scale + scale;
    const product = { n: level.price.n * take, scale: productScale };
    const nextScale = Math.max(notional.scale, product.scale);
    notional = { n: scaleTo(notional, nextScale) + scaleTo(product, nextScale), scale: nextScale };
    const filledScale = Math.max(filled.scale, scale);
    filled = { n: scaleTo(filled, filledScale) + scaleTo({ n: take, scale }, filledScale), scale: filledScale };
    remaining = { n: need - take, scale };
    const leftScale = Math.max(level.qty.scale, scale);
    const left = scaleTo(level.qty, leftScale) - scaleTo({ n: take, scale }, leftScale);
    consumed.push(Object.freeze({
      price: format(level.price.n, level.price.scale),
      quantity: format(take, scale),
      remaining: format(left, leftScale),
    }));
  }
  if (filled.n === 0n) return { ok: false, error: "book is not valid" };
  return {
    ok: true,
    partial: remaining.n !== 0n,
    levels: Object.freeze(consumed),
    filled,
    unfilled: remaining,
    notional,
  };
}

function average(notional, quantity) {
  const denominatorScale = notional.scale - quantity.scale;
  return ratio(notional.n, quantity.n * 10n ** BigInt(denominatorScale));
}

function multiply(notional, rate) {
  return format(notional.n * rate.n, notional.scale + rate.scale);
}

export function simulatePaperFill(input) {
  if (!plainObject(input)) return fail("unsupported field");
  if (Object.hasOwn(input, "lastPrice")) return fail("last price is not a fill");
  if (unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (input.side === undefined || input.side === null || input.side === "") {
    return fail("side is not configured");
  }
  if (!SIDES.includes(input.side)) return fail("unsupported field");
  const quantity = decimalField(input.quantity, "quantity is not configured");
  if (!quantity.ok) return fail(quantity.error);
  const feeRate = optionalZero(input.feeRate, "fee is not configured");
  if (!feeRate.ok) return fail(feeRate.error);
  const latency = optionalZero(input.latency, "latency is not configured");
  if (!latency.ok) return fail(latency.error);
  const view = readSpotDepthView(input.status, { levels: input.levels });
  if (!view.ok || view.executable !== true) {
    return fail(view.ok ? (typeof view.reason === "string" && view.reason.length > 0 ? view.reason : "book is not valid") : view.error);
  }
  const rows = input.side === "buy" ? view.asks : view.bids;
  const direction = input.side === "buy" ? 1 : -1;
  const filled = walk(rows, quantity.parsed, direction);
  if (!filled.ok) return fail(filled.error);
  const averagePrice = average(filled.notional, filled.filled);
  if (averagePrice == null) return fail("book is not valid");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    state: filled.partial ? "partial fill" : "fill",
    partial: filled.partial,
    side: input.side,
    spread: view.spread,
    levels: filled.levels,
    filledQuantity: format(filled.filled.n, filled.filled.scale),
    unfilledQuantity: format(filled.unfilled.n, filled.unfilled.scale),
    averagePrice,
    notional: format(filled.notional.n, filled.notional.scale),
    fee: multiply(filled.notional, feeRate.parsed),
    feeRate: feeRate.value,
    latency: latency.value,
    latencyApplied: false,
    validityTimestamp: view.validityTimestamp,
    bound: view.bound,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_FILL_LIMITATIONS,
  });
}
