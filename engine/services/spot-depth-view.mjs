// Read-only Spot depth for TASK 08.B.02.
// Design page 7 names top 10, 25, and 50 levels as the configurable book bound.
// Design page 8 defines OBI as (bid depth - ask depth) / (bid depth + ask depth).
// Spread is the best ask price minus the best bid price. The source names no other spread formula.
// The source names no rounding scale, so a non-terminating ratio stays a reduced fraction.
// Last trade price is not a depth level. A book that is not healthy is not executable.
// This module does not place orders and does not simulate a fill.

export const DEPTH_LEVEL_BOUNDS = Object.freeze([10, 25, 50]);

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INPUT_KEYS = Object.freeze(["levels"]);

function fail(error) {
  return Object.freeze({
    ok: false,
    executable: false,
    blocked: "BLOCKED",
    error,
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

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function toBig(value) {
  const [wholePart, frac = ""] = value.split(".");
  const digits = `${wholePart}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function scaled(value, scale) {
  return value.n * 10n ** BigInt(scale - value.scale);
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

function gcd(a, b) {
  let left = a;
  let right = b;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function ratio(numerator, denominator) {
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
  const scaledNum = num * 2n ** (scale - twos) * 5n ** (scale - fives);
  return format(neg ? -scaledNum : scaledNum, Number(scale));
}

function comparePrice(left, right) {
  const a = toBig(left);
  const b = toBig(right);
  const scale = Math.max(a.scale, b.scale);
  const an = scaled(a, scale);
  const bn = scaled(b, scale);
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

function addQuantities(rows) {
  let total = { n: 0n, scale: 0 };
  for (const row of rows) {
    const part = toBig(row[1]);
    const scale = Math.max(total.scale, part.scale);
    total = { n: scaled(total, scale) + scaled(part, scale), scale };
  }
  return format(total.n, total.scale);
}

function topLevels(rows, bound, direction) {
  const copy = rows.filter((row) => Array.isArray(row) && decimal(row[0]) && decimal(row[1]));
  copy.sort((left, right) => comparePrice(left[0], right[0]) * direction);
  return copy.slice(0, bound).map((row) => Object.freeze([row[0], row[1]]));
}

function unavailable(reason, bound) {
  return Object.freeze({
    ok: true,
    executable: false,
    blocked: "BLOCKED",
    reason,
    bound,
    validityTimestamp: null,
    bbo: null,
    spread: null,
    imbalance: null,
    bidQuantityTotal: null,
    askQuantityTotal: null,
    bids: Object.freeze([]),
    asks: Object.freeze([]),
  });
}

export function readSpotDepthView(status, input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS) || !DEPTH_LEVEL_BOUNDS.includes(input.levels)) {
    return fail("depth bound is not configured");
  }
  const bound = input.levels;
  if (!plainObject(status) || status.healthy !== true || !plainObject(status.book)) {
    return unavailable(plainObject(status) && typeof status.reason === "string" ? status.reason : "book is not valid", bound);
  }
  const book = status.book;
  if (!whole(book.validityTimestamp) || !Array.isArray(book.bids) || !Array.isArray(book.asks)) {
    return unavailable("book is not valid", bound);
  }
  const bids = Object.freeze(topLevels(book.bids, bound, -1));
  const asks = Object.freeze(topLevels(book.asks, bound, 1));
  if (bids.length === 0 || asks.length === 0) return unavailable("book is not valid", bound);
  const bidPrice = toBig(bids[0][0]);
  const askPrice = toBig(asks[0][0]);
  const scale = Math.max(bidPrice.scale, askPrice.scale);
  const spreadN = scaled(askPrice, scale) - scaled(bidPrice, scale);
  if (spreadN <= 0n) return unavailable("book is not valid", bound);
  const bidQuantityTotal = addQuantities(bids);
  const askQuantityTotal = addQuantities(asks);
  const bidDepth = toBig(bidQuantityTotal);
  const askDepth = toBig(askQuantityTotal);
  const depthScale = Math.max(bidDepth.scale, askDepth.scale);
  const bidN = scaled(bidDepth, depthScale);
  const askN = scaled(askDepth, depthScale);
  if (bidN + askN === 0n) return unavailable("book is not valid", bound);
  return Object.freeze({
    ok: true,
    executable: true,
    blocked: null,
    reason: null,
    bound,
    validityTimestamp: book.validityTimestamp,
    bbo: Object.freeze({
      bidPrice: bids[0][0],
      bidQty: bids[0][1],
      askPrice: asks[0][0],
      askQty: asks[0][1],
    }),
    spread: format(spreadN, scale),
    imbalance: ratio(bidN - askN, bidN + askN),
    bidQuantityTotal,
    askQuantityTotal,
    bids,
    asks,
  });
}
