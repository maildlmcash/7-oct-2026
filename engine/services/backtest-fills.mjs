// Backtest fill accounting for TASK 13.B.01.
// Fees, spread, and depth slippage come from readExecutionCost.
// A book that cannot cover the quantity is not turned into a partial fill.
// A partial fill exists only when the caller supplies a covered filled quantity.
// Funding is recorded only when the caller supplies it. The interval is not converted.
// This module does not place an order.

import { readExecutionCost } from "./execution-costs.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INPUT_KEYS = Object.freeze([
  "bids",
  "asks",
  "quantity",
  "feeRate",
  "lastPrice",
  "filledQuantity",
  "funding",
  "cancelled",
]);

function fail(error, assumptions) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    action: "no-trade",
    assumptions: Object.freeze(assumptions),
    partial: false,
    filledQuantity: null,
    unfilledQuantity: null,
    funding: null,
    netReturn: null,
    costsApplied: false,
    orderSubmitted: false,
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

function compareDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = scaleTo(left, scale);
  const b = scaleTo(right, scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function subtractDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return format(scaleTo(left, scale) - scaleTo(right, scale), scale);
}

function fundingOf(value, assumptions) {
  if (value === undefined) {
    assumptions.push("funding is NOT IN SOURCE");
    return { ok: true, value: null };
  }
  if (value === null) {
    assumptions.push("funding is NOT IN SOURCE");
    return { ok: true, value: null };
  }
  if (!decimal(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

export function simulateBacktestFill(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field", []);
  const assumptions = [];
  const funding = fundingOf(input.funding, assumptions);
  if (!funding.ok) return fail(funding.error, assumptions);
  if (input.cancelled === true) {
    assumptions.unshift("cancellation is caller-supplied");
    return Object.freeze({
      ok: true,
      blocked: null,
      error: null,
      action: "cancelled",
      assumptions: Object.freeze(assumptions),
      partial: false,
      filledQuantity: null,
      unfilledQuantity: input.quantity ?? null,
      funding: funding.value,
      netReturn: null,
      costsApplied: false,
      orderSubmitted: false,
    });
  }
  if (input.cancelled !== undefined && input.cancelled !== false) return fail("unsupported field", assumptions);
  if (input.cancelled === undefined) assumptions.push("cancellation is not configured");
  if (!decimal(input.quantity)) return fail("unsupported field", assumptions);
  let costQuantity = input.quantity;
  let partial = false;
  if (input.filledQuantity !== undefined) {
    if (!decimal(input.filledQuantity)) return fail("unsupported field", assumptions);
    const ordered = parseDecimal(input.quantity);
    const filled = parseDecimal(input.filledQuantity);
    if (filled.n === 0n || compareDecimal(filled, ordered) > 0) return fail("unsupported field", assumptions);
    partial = compareDecimal(filled, ordered) < 0;
    costQuantity = input.filledQuantity;
    assumptions.push(partial
      ? "partial fill uses the caller-supplied filled quantity"
      : "partial fill is not configured");
  } else {
    assumptions.push("partial fill is not configured");
  }
  const costInput = {
    bids: input.bids,
    asks: input.asks,
    quantity: costQuantity,
    feeRate: input.feeRate,
  };
  if (input.lastPrice !== undefined) costInput.lastPrice = input.lastPrice;
  const cost = readExecutionCost(costInput);
  if (!cost.ok) {
    if (cost.error === "depth is not sufficient") {
      assumptions.push("partial fill is not supported when depth cannot cover the quantity");
    }
    return fail(cost.error, assumptions);
  }
  const ordered = parseDecimal(input.quantity);
  const filled = parseDecimal(costQuantity);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    action: null,
    assumptions: Object.freeze(assumptions),
    partial,
    filledQuantity: costQuantity,
    unfilledQuantity: partial ? subtractDecimal(ordered, filled) : "0",
    funding: funding.value,
    netReturn: cost.netReturn,
    spread: cost.spread,
    feeReturn: cost.feeReturn,
    spreadReturn: cost.spreadReturn,
    slippageReturn: cost.slippageReturn,
    costsApplied: true,
    orderSubmitted: false,
  });
}
