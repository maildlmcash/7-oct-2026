// Bounded market visualizations for TASK 10.B.01.
// One named view is read at a time. This module does not plot the other views.
// Series values are caller-supplied. Spread, depth imbalance, and CVD stay the
// formulas in services/market-features.mjs. This module does not calculate them again.
// VWAP stays empty because that formula is NOT IN SOURCE.
// The depth series is a price and quantity table. The source names no color scale.
// Whale-flow reads readCurrentWhaleEligibility. It does not accept wallet points.
// A missing series stays empty. It is not stored as zero.
// direction is always null. No chart guarantees a direction.
// The source names no pixel breakpoint, so every width uses one column.
// This module does not place orders and does not open a network connection.

import { readCurrentWhaleEligibility } from "./whale-eligibility.mjs";

const UNSIGNED = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED = /^(?:0|[1-9]\d*)(?:\.\d+)?$|^-(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/;
const RAW = /^(?:0|[1-9]\d*)$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;

const INPUT_KEYS = Object.freeze(["view", "bound", "from", "to", "points", "stale", "quality"]);
const LAYOUT_KEYS = Object.freeze(["width"]);
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);

export const MARKET_VISUALIZATION_VIEWS = Object.freeze([
  "price/volume",
  "spread",
  "depth heatmap",
  "CVD",
  "VWAP",
  "funding/OI/basis",
  "liquidation",
  "DEX liquidity",
  "whale-flow",
]);

const VIEW_UNITS = Object.freeze({
  "price/volume": "price and volume",
  spread: "price difference",
  "depth heatmap": "price and quantity",
  CVD: "taker buy minus taker sell",
  VWAP: null,
  "funding/OI/basis": "source value",
  liquidation: "source value",
  "DEX liquidity": "raw amount",
  "whale-flow": null,
});

const POINT_KEYS = Object.freeze({
  "price/volume": Object.freeze(["eventTime", "price", "volume"]),
  spread: Object.freeze(["eventTime", "value"]),
  "depth heatmap": Object.freeze(["eventTime", "price", "quantity"]),
  CVD: Object.freeze(["eventTime", "value"]),
  "funding/OI/basis": Object.freeze(["eventTime", "funding", "openInterest", "basis"]),
  liquidation: Object.freeze(["eventTime", "value"]),
  "DEX liquidity": Object.freeze(["eventTime", "amount"]),
});

// The source names no chart breakpoint. columns stays 1 at every width.
export const MARKET_VISUALIZATION_LAYOUT = Object.freeze({
  columns: 1,
  stack: "column",
  maxWidth: "100%",
  wrap: true,
});

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    direction: null,
    guaranteesDirection: false,
    points: Object.freeze([]),
    entries: null,
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

function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function eventTimeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeDigits(value) {
  return typeof value === "number" ? String(value) : value;
}

function compareTime(left, right) {
  const a = timeDigits(left);
  const b = timeDigits(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function measure(value, signed) {
  return typeof value === "string" && (signed ? SIGNED : UNSIGNED).test(value);
}

function qualityState(value) {
  if (value === undefined || value === null) return { ok: true, stale: false, quality: null };
  if (value === "degraded") {
    return {
      ok: true,
      stale: true,
      quality: Object.freeze({ healthy: false, reason: "degraded" }),
    };
  }
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false };
  if (typeof value.healthy !== "boolean") return { ok: false };
  if (value.reason !== null && !filled(value.reason)) return { ok: false };
  const stale = value.healthy !== true || value.reason !== null;
  return {
    ok: true,
    stale,
    quality: Object.freeze({ healthy: value.healthy, reason: value.reason }),
  };
}

function staleState(input) {
  if (input.stale !== undefined && typeof input.stale !== "boolean") return { ok: false };
  const quality = qualityState(input.quality);
  if (!quality.ok) return { ok: false };
  const stale = input.stale === true || quality.stale;
  if (!stale) return { ok: true, stale: false, quality: quality.quality };
  const reason = quality.quality && quality.quality.reason ? quality.quality.reason : "stale stream";
  return {
    ok: true,
    stale: true,
    quality: Object.freeze({ healthy: false, reason }),
  };
}

function result(fields) {
  const points = Object.freeze((fields.points ?? []).map((point) => Object.freeze(point)));
  return Object.freeze({
    ok: fields.ok !== false,
    blocked: fields.blocked ?? null,
    error: fields.error ?? null,
    view: fields.view,
    unit: VIEW_UNITS[fields.view],
    direction: null,
    guaranteesDirection: false,
    stale: fields.stale === true,
    empty: points.length === 0,
    truncated: fields.truncated === true,
    bound: fields.bound,
    from: fields.from ?? null,
    to: fields.to ?? null,
    rangeSet: fields.rangeSet === true,
    formula: fields.formula ?? null,
    palette: null,
    points,
    entries: fields.entries ?? null,
    note: fields.note ?? null,
    quality: fields.quality ?? null,
    layout: MARKET_VISUALIZATION_LAYOUT,
  });
}

function optionalSigned(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!measure(value, true)) return { ok: false };
  return { ok: true, value };
}

function normalizePoint(view, point) {
  if (!plainObject(point) || unknownKey(point, POINT_KEYS[view])) return null;
  if (!eventTimeValue(point.eventTime)) return null;
  if (view === "price/volume") {
    if (!measure(point.price, false) || !measure(point.volume, false)) return null;
    return { eventTime: point.eventTime, price: point.price, volume: point.volume };
  }
  if (view === "spread" || view === "liquidation") {
    if (!measure(point.value, view === "liquidation")) return null;
    return { eventTime: point.eventTime, value: point.value };
  }
  if (view === "depth heatmap") {
    if (!measure(point.price, false) || !measure(point.quantity, false)) return null;
    return { eventTime: point.eventTime, price: point.price, quantity: point.quantity };
  }
  if (view === "CVD") {
    if (!measure(point.value, true)) return null;
    return { eventTime: point.eventTime, value: point.value };
  }
  if (view === "funding/OI/basis") {
    const funding = optionalSigned(point.funding);
    const openInterest = optionalSigned(point.openInterest);
    const basis = optionalSigned(point.basis);
    if (!funding.ok || !openInterest.ok || !basis.ok) return null;
    return {
      eventTime: point.eventTime,
      funding: funding.value,
      openInterest: openInterest.value,
      basis: basis.value,
    };
  }
  if (!measure(point.amount, false) || !RAW.test(point.amount)) return null;
  return { eventTime: point.eventTime, amount: point.amount };
}

function normalizePoints(view, points) {
  if (points === undefined) return { ok: true, points: [] };
  if (!Array.isArray(points)) return { ok: false };
  const normalized = [];
  for (const point of points) {
    const next = normalizePoint(view, point);
    if (!next) return { ok: false };
    normalized.push(next);
  }
  return { ok: true, points: normalized };
}

function inRange(eventTime, from, to) {
  return compareTime(eventTime, from) >= 0 && compareTime(eventTime, to) <= 0;
}

function boundPoints(points, from, to, bound) {
  const indexed = [];
  for (let index = 0; index < points.length; index += 1) {
    if (inRange(points[index].eventTime, from, to)) indexed.push({ point: points[index], index });
  }
  indexed.sort((left, right) => {
    const order = compareTime(left.point.eventTime, right.point.eventTime);
    return order === 0 ? left.index - right.index : order;
  });
  return {
    points: indexed.slice(0, bound).map((item) => item.point),
    truncated: indexed.length > bound,
  };
}

export function marketVisualizationLayout(input) {
  const source = input === undefined ? {} : input;
  if (!plainObject(source) || unknownKey(source, LAYOUT_KEYS)) return fail("unsupported field");
  if (source.width !== undefined && !positive(source.width)) return fail("unsupported field");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    columns: MARKET_VISUALIZATION_LAYOUT.columns,
    stack: MARKET_VISUALIZATION_LAYOUT.stack,
    maxWidth: MARKET_VISUALIZATION_LAYOUT.maxWidth,
    wrap: MARKET_VISUALIZATION_LAYOUT.wrap,
    width: source.width === undefined ? null : source.width,
    direction: null,
    guaranteesDirection: false,
  });
}

export function readMarketVisualization(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  if (input.view === undefined || input.view === null || input.view === "") return fail("view is required");
  if (!MARKET_VISUALIZATION_VIEWS.includes(input.view)) return fail("unsupported field");
  if (!positive(input.bound)) return fail("bound is required");
  const stale = staleState(input);
  if (!stale.ok) return fail("unsupported field");
  const view = input.view;
  const hasFrom = input.from !== undefined && input.from !== null;
  const hasTo = input.to !== undefined && input.to !== null;
  if (hasFrom && !eventTimeValue(input.from)) return fail("unsupported field");
  if (hasTo && !eventTimeValue(input.to)) return fail("unsupported field");
  if ((view === "whale-flow" || view === "VWAP") && input.points !== undefined) return fail("unsupported field");
  const rangeSet = hasFrom && hasTo;
  if (rangeSet && compareTime(input.from, input.to) > 0) return fail("unsupported field");

  if (view === "whale-flow") {
    const eligibility = readCurrentWhaleEligibility();
    return result({
      ok: false,
      blocked: eligibility.blocked,
      error: eligibility.error,
      view,
      bound: input.bound,
      from: rangeSet ? input.from : null,
      to: rangeSet ? input.to : null,
      rangeSet,
      stale: stale.stale,
      quality: stale.quality,
      points: [],
      entries: Object.freeze(Array.isArray(eligibility.entries) ? eligibility.entries.slice() : []),
      note: eligibility.error,
    });
  }

  if (!rangeSet) {
    const parsed = normalizePoints(view, input.points);
    if (!parsed.ok) return fail("unsupported field");
    return result({
      view,
      bound: input.bound,
      rangeSet: false,
      stale: stale.stale,
      quality: stale.quality,
      points: [],
      formula: view === "VWAP" ? "NOT IN SOURCE" : null,
      note: "time range is not set",
    });
  }

  if (view === "VWAP") {
    return result({
      view,
      bound: input.bound,
      from: input.from,
      to: input.to,
      rangeSet: true,
      stale: stale.stale,
      quality: stale.quality,
      points: [],
      formula: "NOT IN SOURCE",
    });
  }

  const parsed = normalizePoints(view, input.points);
  if (!parsed.ok) return fail("unsupported field");
  if (stale.stale) {
    return result({
      view,
      bound: input.bound,
      from: input.from,
      to: input.to,
      rangeSet: true,
      stale: true,
      quality: stale.quality,
      points: [],
    });
  }
  const bounded = boundPoints(parsed.points, input.from, input.to, input.bound);
  return result({
    view,
    bound: input.bound,
    from: input.from,
    to: input.to,
    rangeSet: true,
    stale: false,
    quality: stale.quality,
    points: bounded.points,
    truncated: bounded.truncated,
  });
}
