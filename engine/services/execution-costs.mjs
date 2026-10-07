// Executable cost assumptions for TASK 11.A.02.
// A fill is the quantity walked through the visible bid and ask levels.
// lastPrice is not a fill. A book that cannot cover the quantity is not a partial fill.
// Spread is the best ask minus the best bid. Slippage is the average price beyond that touch.
// Impact is the spread plus that slippage, measured against the mid price.
// Round-trip fee is twice the caller-supplied fee rate. The source names no fee tier.
// An uncertain cost is no-trade with low confidence. This module does not place orders.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INPUT_KEYS = Object.freeze(["bids", "asks", "quantity", "feeRate", "lastPrice"]);

export const EXECUTION_NET_RETURN = "round-trip fee plus spread and depth slippage";

function fail(error, uncertain) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    action: uncertain ? "no-trade" : null,
    confidence: uncertain ? "low" : null,
    feeReturn: null,
    spreadReturn: null,
    slippageReturn: null,
    impactReturn: null,
    netReturn: null,
    spread: null,
    averageBuy: null,
    averageSell: null,
    costsApplied: false,
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
  const an = left.n * 10n ** BigInt(scale - left.scale);
  const bn = right.n * 10n ** BigInt(scale - right.scale);
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function fraction(numerator, numeratorScale, denominator, denominatorScale) {
  if (denominator === 0n) return null;
  if (denominatorScale >= numeratorScale) {
    return {
      n: numerator * 10n ** BigInt(denominatorScale - numeratorScale),
      d: denominator,
    };
  }
  return {
    n: numerator,
    d: denominator * 10n ** BigInt(numeratorScale - denominatorScale),
  };
}

function addFraction(left, right) {
  return {
    n: left.n * right.d + right.n * left.d,
    d: left.d * right.d,
  };
}

function bookSide(rows, direction) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, uncertain: true };
  const byPrice = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2 || !decimal(row[0]) || !decimal(row[1])) {
      return { ok: false, uncertain: false };
    }
    const price = parseDecimal(row[0]);
    const qty = parseDecimal(row[1]);
    if (!price || !qty || qty.n === 0n) return { ok: false, uncertain: false };
    const key = format(price.n, price.scale);
    const prior = byPrice.get(key);
    if (!prior) {
      byPrice.set(key, { price, qty });
      continue;
    }
    const scale = Math.max(prior.qty.scale, qty.scale);
    prior.qty = { n: scaleTo(prior.qty, scale) + scaleTo(qty, scale), scale };
  }
  const levels = [...byPrice.values()].sort((left, right) => comparePrice(left.price, right.price) * direction);
  return { ok: true, levels };
}

function walk(levels, quantity) {
  let remaining = { n: quantity.n, scale: quantity.scale };
  let notional = { n: 0n, scale: 0 };
  let last = null;
  for (const level of levels) {
    if (remaining.n === 0n) break;
    const scale = Math.max(remaining.scale, level.qty.scale);
    const need = scaleTo(remaining, scale);
    const have = scaleTo(level.qty, scale);
    const take = need < have ? need : have;
    const productScale = level.price.scale + scale;
    const product = {
      n: level.price.n * take,
      scale: productScale,
    };
    const nextScale = Math.max(notional.scale, product.scale);
    notional = {
      n: scaleTo(notional, nextScale) + scaleTo(product, nextScale),
      scale: nextScale,
    };
    remaining = { n: need - take, scale };
    last = level.price;
  }
  if (remaining.n !== 0n) return { covered: false };
  return { covered: true, notional, last };
}

function average(notional, quantity) {
  const denominatorScale = notional.scale - quantity.scale;
  return ratio(notional.n, quantity.n * 10n ** BigInt(denominatorScale));
}

function quoted(parts) {
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    action: null,
    confidence: null,
    feeReturn: parts.feeReturn,
    spreadReturn: parts.spreadReturn,
    slippageReturn: parts.slippageReturn,
    impactReturn: parts.impactReturn,
    netReturn: parts.netReturn,
    spread: parts.spread,
    averageBuy: parts.averageBuy,
    averageSell: parts.averageSell,
    costsApplied: true,
  });
}

export function readExecutionCost(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field", false);
  if (input.lastPrice !== undefined && input.lastPrice !== null && !decimal(input.lastPrice)) {
    return fail("unsupported field", false);
  }
  const bookMissing = !Array.isArray(input.bids) || !Array.isArray(input.asks)
    || input.bids.length === 0 || input.asks.length === 0;
  if (bookMissing) {
    if (input.lastPrice !== undefined && input.lastPrice !== null) return fail("last price is not a fill", true);
    return fail("book is not valid", true);
  }
  const bids = bookSide(input.bids, -1);
  const asks = bookSide(input.asks, 1);
  if (!bids.ok || !asks.ok) return fail("unsupported field", false);
  const bestBid = bids.levels[0].price;
  const bestAsk = asks.levels[0].price;
  if (comparePrice(bestAsk, bestBid) <= 0) return fail("book is not valid", true);
  if (input.quantity === undefined || input.quantity === null || input.quantity === "") {
    return fail("quantity is not configured", true);
  }
  const quantity = parseDecimal(input.quantity);
  if (!quantity || quantity.n === 0n) return fail("unsupported field", false);
  if (input.feeRate === undefined || input.feeRate === null || input.feeRate === "") {
    return fail("fee is not configured", true);
  }
  const fee = parseDecimal(input.feeRate);
  if (!fee) return fail("unsupported field", false);
  const buy = walk(asks.levels, quantity);
  const sell = walk(bids.levels, quantity);
  if (!buy.covered || !sell.covered) return fail("depth is not sufficient", true);

  const priceScale = Math.max(bestBid.scale, bestAsk.scale);
  const bidN = scaleTo(bestBid, priceScale);
  const askN = scaleTo(bestAsk, priceScale);
  const spreadN = askN - bidN;
  const midSum = bidN + askN;
  const spreadReturn = fraction(2n * spreadN, 0n, midSum, 0n);

  const buyTouch = { n: bestAsk.n * quantity.n, scale: bestAsk.scale + quantity.scale };
  const sellTouch = { n: bestBid.n * quantity.n, scale: bestBid.scale + quantity.scale };
  const extraScale = Math.max(buy.notional.scale, sell.notional.scale, buyTouch.scale, sellTouch.scale);
  const buyExtra = scaleTo(buy.notional, extraScale) - scaleTo(buyTouch, extraScale);
  const sellExtra = scaleTo(sellTouch, extraScale) - scaleTo(sell.notional, extraScale);
  const qtySumScale = quantity.scale + priceScale;
  const qtySum = quantity.n * midSum;
  const slippageReturn = fraction(2n * (buyExtra + sellExtra), extraScale, qtySum, qtySumScale);
  const impact = addFraction(spreadReturn, slippageReturn);
  const feeReturn = fraction(2n * fee.n, 0n, 10n ** BigInt(fee.scale), 0n);
  const cost = addFraction(feeReturn, impact);
  return quoted({
    feeReturn: ratio(feeReturn.n, feeReturn.d),
    spreadReturn: ratio(spreadReturn.n, spreadReturn.d),
    slippageReturn: ratio(slippageReturn.n, slippageReturn.d),
    impactReturn: ratio(impact.n, impact.d),
    netReturn: ratio(-cost.n, cost.d),
    spread: format(spreadN, priceScale),
    averageBuy: average(buy.notional, quantity),
    averageSell: average(sell.notional, quantity),
  });
}
