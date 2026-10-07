// Passive paper-queue estimates for TASK 14.B.02.
// The design names no queue position and no latency number. These rules are the
// conservative assumptions, and every report labels the fill as an estimate.
// The order joins behind the visible quantity at its price. Only a later print at
// that price can reduce that queue. Another order's cancellation does not.
// A passive buy counts a trade only when the buyer is the market maker. A passive
// sell counts a trade only when the buyer is not. The stream says to ignore M.
// Latency is added to the placed time on the trade-time clock and does not change
// the price. A trade at or before the live time does not count. lastPrice is not
// a level. This module does not open a venue client and does not append an order.

import { parseSpotStreamMessage } from "./binance-spot-public.mjs";
import { readSpotDepthView } from "./spot-depth-view.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze([
  "status",
  "levels",
  "symbol",
  "side",
  "price",
  "quantity",
  "feeRate",
  "placedAt",
  "latency",
  "trades",
  "cancelledAt",
]);
const SIDES = Object.freeze(["buy", "sell"]);

export const PAPER_QUEUE_ASSUMPTIONS = Object.freeze([
  "simulated fill is an estimate",
  "queue position is behind the visible quantity at the passive price",
  "a trade at or before the live time does not fill the order",
  "cancellations of other orders do not improve queue position",
  "a print at another price does not fill the order",
  "a passive buy counts only a trade where the buyer is the market maker",
  "a passive sell counts only a trade where the buyer is not the market maker",
  "the trade flag M is ignored",
  "a repeated trade id is counted once",
  "latency is added to the placed time on the trade-time clock and does not change price",
  "hidden quantity is NOT IN SOURCE",
  "queue priority beyond visible size is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    estimate: true,
    assumptions: PAPER_QUEUE_ASSUMPTIONS,
    state: null,
    partial: false,
    side: null,
    price: null,
    spread: null,
    queueAhead: null,
    liveAt: null,
    filledQuantity: null,
    unfilledQuantity: null,
    averagePrice: null,
    notional: null,
    fee: null,
    feeRate: null,
    latency: null,
    latencyApplied: false,
    cancelled: false,
    validityTimestamp: null,
    bound: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_QUEUE_ASSUMPTIONS,
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

function leaked(value) {
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value) || leaked(value)) {
    return { ok: false, error: leaked(value) ? "secret value is not allowed" : "unsupported field" };
  }
  return { ok: true, value };
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseDecimal(value) {
  if (!decimal(value)) return null;
  const [wholePart, frac = ""] = value.split(".");
  const digits = `${wholePart}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
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

function compareDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaleTo(left, scale);
  const b = scaleTo(right, scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function priceKey(part) {
  return format(part.n, part.scale);
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

function timeField(value, missing) {
  if (value === undefined || value === null || value === "") return { ok: false, error: missing };
  if (!whole(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

function aggregate(rows) {
  const byPrice = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) return null;
    const price = parseDecimal(row[0]);
    const qty = parseDecimal(row[1]);
    if (!price || !qty) return null;
    if (qty.n === 0n) continue;
    const key = priceKey(price);
    const prior = byPrice.get(key);
    if (!prior) {
      byPrice.set(key, { price, qty });
      continue;
    }
    const scale = Math.max(prior.qty.scale, qty.scale);
    prior.qty = { n: scaleTo(prior.qty, scale) + scaleTo(qty, scale), scale };
  }
  return byPrice;
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) + scaleTo(right, scale), scale };
}

function addWhole(wholeNumber, latency) {
  const scale = latency.scale;
  return { n: BigInt(wholeNumber) * 10n ** BigInt(scale) + latency.n, scale };
}

function after(time, boundary) {
  return compareDecimal({ n: BigInt(time), scale: 0 }, boundary) > 0;
}

function multiply(notional, rate) {
  return format(notional.n * rate.n, notional.scale + rate.scale);
}

function cappedFill(volume, ahead, order) {
  const scale = Math.max(volume.scale, ahead.scale, order.scale);
  let n = scaleTo(volume, scale) - scaleTo(ahead, scale);
  if (n < 0n) n = 0n;
  const cap = scaleTo(order, scale);
  if (n > cap) n = cap;
  return { n, scale };
}

export function estimatePaperQueue(input) {
  if (!plainObject(input)) return fail("unsupported field");
  if (Object.hasOwn(input, "lastPrice")) return fail("last price is not a fill");
  if (unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const symbol = named(input.symbol, "symbol is not configured");
  if (!symbol.ok) return fail(symbol.error);
  if (input.side === undefined || input.side === null || input.side === "") {
    return fail("side is not configured");
  }
  if (!SIDES.includes(input.side)) return fail("unsupported field");
  const price = decimalField(input.price, "price is not configured");
  if (!price.ok) return fail(price.error);
  const quantity = decimalField(input.quantity, "quantity is not configured");
  if (!quantity.ok) return fail(quantity.error);
  const feeRate = optionalZero(input.feeRate, "fee is not configured");
  if (!feeRate.ok) return fail(feeRate.error);
  const placedAt = timeField(input.placedAt, "placed time is not configured");
  if (!placedAt.ok) return fail(placedAt.error);
  const latency = optionalZero(input.latency, "latency is not configured");
  if (!latency.ok) return fail(latency.error);
  if (!Array.isArray(input.trades)) return fail("trades are not configured");
  let cancelledAt = null;
  if (Object.hasOwn(input, "cancelledAt")) {
    const cancel = timeField(input.cancelledAt, "cancel time is not configured");
    if (!cancel.ok) return fail(cancel.error);
    cancelledAt = cancel.value;
  }
  const view = readSpotDepthView(input.status, { levels: input.levels });
  if (!view.ok || view.executable !== true) {
    const reason = view.ok
      ? (typeof view.reason === "string" && view.reason.length > 0 ? view.reason : "book is not valid")
      : view.error;
    return fail(reason);
  }
  const bid = parseDecimal(view.bbo.bidPrice);
  const ask = parseDecimal(view.bbo.askPrice);
  if (!bid || !ask) return fail("book is not valid");
  const passive = input.side === "buy"
    ? compareDecimal(price.parsed, ask) < 0
    : compareDecimal(price.parsed, bid) > 0;
  if (!passive) return fail("order is not passive");
  const book = aggregate(input.side === "buy" ? view.bids : view.asks);
  if (!book) return fail("book is not valid");
  const ahead = book.get(priceKey(price.parsed))?.qty ?? { n: 0n, scale: 0 };
  const live = addWhole(placedAt.value, latency.parsed);
  const seen = new Set();
  let volume = { n: 0n, scale: 0 };
  for (const raw of input.trades) {
    const parsed = parseSpotStreamMessage(raw);
    if (!parsed.ok || parsed.kind !== "spot-trade") return fail("trade schema is not allowed");
    const event = parsed.event;
    if (event.s !== symbol.value) return fail("trade symbol does not match");
    if (seen.has(event.t)) continue;
    seen.add(event.t);
    if (priceKey(parseDecimal(event.p)) !== priceKey(price.parsed)) continue;
    const buyerIsMaker = event.m === true;
    if (input.side === "buy" ? !buyerIsMaker : buyerIsMaker) continue;
    if (!after(event.T, live)) continue;
    if (cancelledAt != null && !(BigInt(event.T) < BigInt(cancelledAt))) continue;
    volume = add(volume, parseDecimal(event.q));
  }
  const filledQty = cappedFill(volume, ahead, quantity.parsed);
  const unfilledScale = Math.max(quantity.parsed.scale, filledQty.scale);
  const unfilled = {
    n: scaleTo(quantity.parsed, unfilledScale) - scaleTo(filledQty, unfilledScale),
    scale: unfilledScale,
  };
  const filledSomething = filledQty.n > 0n;
  const full = compareDecimal(filledQty, quantity.parsed) === 0;
  let state = null;
  if (full) state = "fill";
  else if (cancelledAt != null) state = "cancel";
  else if (filledSomething) state = "partial fill";
  const notional = filledSomething
    ? { n: price.parsed.n * filledQty.n, scale: price.parsed.scale + filledQty.scale }
    : { n: 0n, scale: 0 };
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    estimate: true,
    assumptions: PAPER_QUEUE_ASSUMPTIONS,
    state,
    partial: filledSomething && !full,
    side: input.side,
    price: price.value,
    spread: view.spread,
    queueAhead: format(ahead.n, ahead.scale),
    liveAt: format(live.n, live.scale),
    filledQuantity: format(filledQty.n, filledQty.scale),
    unfilledQuantity: format(unfilled.n, unfilled.scale),
    averagePrice: filledSomething ? price.value : null,
    notional: format(notional.n, notional.scale),
    fee: filledSomething ? multiply(notional, feeRate.parsed) : "0",
    feeRate: feeRate.value,
    latency: latency.value,
    latencyApplied: false,
    cancelled: cancelledAt != null && !full,
    validityTimestamp: view.validityTimestamp,
    bound: view.bound,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_QUEUE_ASSUMPTIONS,
  });
}
