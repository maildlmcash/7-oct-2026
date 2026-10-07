// Read-only trader input for TASK 08.A.01.
// The view carries venue, symbol, product, BBO, event age, quality, and sequence watermark.
// BBO fields are best bid and ask decimal strings. Last-trade price is not a BBO.
// The source names no maximum event age. A negative age is clock skew and is stale.
// A sequence at or behind the caller watermark is stale. The first watermark is null.
// This module does not place orders and does not connect a trader.

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const INPUT_KEYS = Object.freeze([
  "venue",
  "symbol",
  "product",
  "expectedProduct",
  "bbo",
  "eventAge",
  "quality",
  "sequence",
  "sequenceWatermark",
]);
const BBO_KEYS = Object.freeze(["bidPrice", "bidQty", "askPrice", "askQty"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);

export const TRADER_INPUT_VIEW_KEYS = Object.freeze([
  "venue",
  "symbol",
  "product",
  "bbo",
  "eventAge",
  "quality",
  "sequenceWatermark",
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

function text(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function symbol(value) {
  return typeof value === "string" && SYMBOL.test(value);
}

function sequenceValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function sequenceDigits(value) {
  return typeof value === "number" ? String(value) : value;
}

function compareSequence(left, right) {
  const a = sequenceDigits(left);
  const b = sequenceDigits(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function eventAgeState(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return { ok: false, stale: false };
  if (value < 0) return { ok: false, stale: true };
  return { ok: true, stale: false };
}

function qualityState(value) {
  if (value === "degraded") return { ok: false, stale: true };
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false, stale: false };
  if (typeof value.healthy !== "boolean") return { ok: false, stale: false };
  if (value.reason !== null && !text(value.reason)) return { ok: false, stale: false };
  if (value.healthy !== true || value.reason !== null) return { ok: false, stale: true };
  return { ok: true, stale: false };
}

export function readTraderInput(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("trader input is incomplete");
  for (const key of INPUT_KEYS) {
    if (!Object.hasOwn(input, key)) return fail("trader input is incomplete");
  }
  if (!text(input.venue) || !symbol(input.symbol)) return fail("trader input is incomplete");
  if (!text(input.product) || !text(input.expectedProduct)) return fail("trader input is incomplete");
  if (!plainObject(input.bbo) || unknownKey(input.bbo, BBO_KEYS)) return fail("trader input is incomplete");
  for (const key of BBO_KEYS) {
    if (!decimal(input.bbo[key])) return fail("trader input is incomplete");
  }
  if (!sequenceValue(input.sequence)) return fail("trader input is incomplete");
  if (input.sequenceWatermark !== null && !sequenceValue(input.sequenceWatermark)) {
    return fail("trader input is incomplete");
  }
  const age = eventAgeState(input.eventAge);
  if (!age.stale && !age.ok) return fail("trader input is incomplete");
  const quality = qualityState(input.quality);
  if (!quality.stale && !quality.ok) return fail("trader input is incomplete");
  if (input.product !== input.expectedProduct) return fail("product is not allowed");
  if (age.stale || quality.stale) return fail("trader input is stale");
  if (input.sequenceWatermark !== null && compareSequence(input.sequence, input.sequenceWatermark) <= 0) {
    return fail("trader input is stale");
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    view: Object.freeze({
      venue: input.venue,
      symbol: input.symbol,
      product: input.product,
      bbo: Object.freeze({
        bidPrice: input.bbo.bidPrice,
        bidQty: input.bbo.bidQty,
        askPrice: input.bbo.askPrice,
        askQty: input.bbo.askQty,
      }),
      eventAge: input.eventAge,
      quality: Object.freeze({ healthy: true, reason: null }),
      sequenceWatermark: input.sequence,
    }),
  });
}
