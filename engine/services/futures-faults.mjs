// Futures feed faults for TASK 12.C.01.
// Design page 9 says a stale mark or index feed, and a missing liquidation
// feed, withhold futures use. A stale feature is vetoed rather than treated
// as neutral. Design page 9 also names a stale funding feed.
// The source names no open-interest discontinuity magnitude, so a value
// change is not a discontinuity. The caller injects that fault.
// The source names no mark-index divergence limit. This module does not
// apply one. Spot data is never copied into the prediction.
// This module does not place an order and does not calculate a score.

const DIGITS = /^(?:0|[1-9]\d*)$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FEED_KEYS = Object.freeze(["value", "eventTime", "sequence", "sequenceWatermark", "quality"]);
const OPEN_INTEREST_KEYS = Object.freeze([...FEED_KEYS, "discontinuity"]);
const LIQUIDATION_KEYS = Object.freeze(["status", "eventTime", "quality", "events"]);
const PREDICTION_KEYS = Object.freeze(["product", "score"]);
const INPUT_KEYS = Object.freeze([
  "asOf",
  "receiveTime",
  "lagThreshold",
  "mark",
  "index",
  "funding",
  "openInterest",
  "liquidationFeed",
  "prediction",
  "spot",
]);
const REQUIRED_KEYS = Object.freeze(INPUT_KEYS.filter((key) => key !== "spot"));
const QUALITY_KEYS = Object.freeze(["healthy", "reason"]);
const KNOWN_REASONS = new Set([
  "stale stream",
  "degraded",
  "sequence gap",
  "clock skew",
  "reorg",
  "unverified",
  "late event",
  "outage",
]);
const LIQUIDATION_STATUS = new Set(["available", "outage"]);

export const FUTURES_FAULTS = Object.freeze([
  "stale mark/index",
  "funding gap",
  "open-interest discontinuity",
  "liquidation-feed outage",
]);
export const FUTURES_FAULT_STATES = Object.freeze({
  "stale mark/index": "abstain",
  "stale funding": "abstain",
  "funding gap": "abstain",
  "open-interest discontinuity": "abstain",
  "liquidation-feed outage": "degraded",
});
export const FUTURES_PREDICTION_SUPPRESSED = Object.freeze({
  "stale mark/index": true,
  "stale funding": true,
  "funding gap": true,
  "open-interest discontinuity": true,
  "liquidation-feed outage": true,
});

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    state: null,
    suppressed: true,
    product: null,
    score: null,
    prediction: null,
    spotFallback: false,
    alerts: Object.freeze([]),
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

function missingKey(value) {
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeBig(value) {
  return BigInt(typeof value === "number" ? String(value) : value);
}

function blank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function publicReason(reason) {
  if (KNOWN_REASONS.has(reason)) return reason;
  return "degraded";
}

function qualityOf(value) {
  if (value === "degraded") return { ok: true, healthy: false, reason: "degraded" };
  if (!plainObject(value) || unknownKey(value, QUALITY_KEYS)) return { ok: false, error: "unsupported field" };
  if (typeof value.healthy !== "boolean") return { ok: false, error: "unsupported field" };
  if (value.reason !== null && (typeof value.reason !== "string" || value.reason.trim() === "" || value.reason !== value.reason.trim())) {
    return { ok: false, error: "unsupported field" };
  }
  const healthy = value.healthy === true && value.reason === null;
  return { ok: true, healthy, reason: value.reason };
}

function clockOf(feed, asOf, receiveTime, lagThreshold) {
  if (!timeValue(feed.eventTime) || !timeValue(asOf) || !timeValue(receiveTime) || !timeValue(lagThreshold)) {
    return { ok: false, error: "unsupported field" };
  }
  if (timeBig(lagThreshold) < 0n) return { ok: false, error: "unsupported field" };
  const event = timeBig(feed.eventTime);
  const received = timeBig(receiveTime);
  const decision = timeBig(asOf);
  if (event > decision) return { ok: true, lookahead: true };
  if (event > received) return { ok: true, stale: true, reason: "clock skew" };
  if (received - event > timeBig(lagThreshold)) return { ok: true, stale: true, reason: "late event" };
  return { ok: true, stale: false, lookahead: false };
}

function sequenceOf(feed) {
  if (!timeValue(feed.sequence)) return { ok: false, error: "unsupported field" };
  if (feed.sequenceWatermark !== null && !timeValue(feed.sequenceWatermark)) {
    return { ok: false, error: "unsupported field" };
  }
  return { ok: true };
}

function sequenceStale(feed) {
  if (feed.sequenceWatermark === null) return false;
  return timeBig(feed.sequence) <= timeBig(feed.sequenceWatermark);
}

function sequenceGap(feed) {
  if (feed.sequenceWatermark === null) return false;
  return timeBig(feed.sequence) > timeBig(feed.sequenceWatermark) + 1n;
}

function priceValue(value) {
  return typeof value === "string" && DECIMAL.test(value) && value !== "0";
}

function signedValue(value) {
  return typeof value === "string" && SIGNED.test(value);
}

function nonNegativeValue(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function alert(fault, source, reason) {
  return Object.freeze({
    fault,
    state: FUTURES_FAULT_STATES[fault],
    source,
    suppressed: true,
    reason: reason ?? null,
  });
}

function predictionState(alerts) {
  if (alerts.some((item) => item.state === "abstain")) return "abstain";
  if (alerts.length > 0) return alerts[0].state;
  return null;
}

function readPrediction(value) {
  if (value === undefined || value === null) return { ok: false, error: "prediction is not configured" };
  if (!plainObject(value) || unknownKey(value, PREDICTION_KEYS)) return { ok: false, error: "unsupported field" };
  if (value.product !== "futures") return { ok: false, error: "prediction product is not futures" };
  if (blank(value.score)) return { ok: false, error: "prediction is not configured" };
  if (!signedValue(value.score)) return { ok: false, error: "unsupported field" };
  return { ok: true, score: value.score };
}

function readPrice(feed, asOf, receiveTime, lagThreshold) {
  if (!plainObject(feed) || unknownKey(feed, FEED_KEYS)) return { ok: false, error: "unsupported field" };
  const quality = qualityOf(feed.quality);
  if (!quality.ok) return quality;
  const sequence = sequenceOf(feed);
  if (!sequence.ok) return sequence;
  const clock = clockOf(feed, asOf, receiveTime, lagThreshold);
  if (!clock.ok) return clock;
  if (clock.lookahead) return { ok: false, error: "lookahead window" };
  if (!priceValue(feed.value)) return { ok: false, error: "unsupported field" };
  let stale = clock.stale === true || !quality.healthy || sequenceStale(feed);
  let reason = clock.reason ?? null;
  if (!quality.healthy) reason = publicReason(quality.reason);
  else if (sequenceStale(feed)) reason = "stale stream";
  return { ok: true, stale, reason: stale ? reason : null };
}

function readFunding(feed, asOf, receiveTime, lagThreshold) {
  if (!plainObject(feed) || unknownKey(feed, FEED_KEYS)) return { ok: false, error: "unsupported field" };
  const quality = qualityOf(feed.quality);
  if (!quality.ok) return quality;
  const sequence = sequenceOf(feed);
  if (!sequence.ok) return sequence;
  const clock = clockOf(feed, asOf, receiveTime, lagThreshold);
  if (!clock.ok) return clock;
  if (clock.lookahead) return { ok: false, error: "lookahead window" };
  if (!signedValue(feed.value)) return { ok: false, error: "unsupported field" };
  const gap = quality.reason === "sequence gap" || sequenceGap(feed);
  if (gap) return { ok: true, fault: "funding gap", reason: "sequence gap" };
  const stale = clock.stale === true || !quality.healthy || sequenceStale(feed);
  if (!stale) return { ok: true, fault: null };
  let reason = clock.reason ?? "stale stream";
  if (!quality.healthy) reason = publicReason(quality.reason);
  else if (sequenceStale(feed)) reason = "stale stream";
  return { ok: true, fault: "stale funding", reason };
}

function readOpenInterest(feed, asOf, receiveTime, lagThreshold) {
  if (!plainObject(feed) || unknownKey(feed, OPEN_INTEREST_KEYS)) return { ok: false, error: "unsupported field" };
  if (feed.discontinuity === undefined || feed.discontinuity === null) {
    return { ok: false, error: "open-interest discontinuity is not configured" };
  }
  if (typeof feed.discontinuity !== "boolean") return { ok: false, error: "unsupported field" };
  const quality = qualityOf(feed.quality);
  if (!quality.ok) return quality;
  const sequence = sequenceOf(feed);
  if (!sequence.ok) return sequence;
  const clock = clockOf(feed, asOf, receiveTime, lagThreshold);
  if (!clock.ok) return clock;
  if (clock.lookahead) return { ok: false, error: "lookahead window" };
  if (!nonNegativeValue(feed.value)) return { ok: false, error: "unsupported field" };
  if (feed.discontinuity === true) return { ok: true, fault: "open-interest discontinuity" };
  return { ok: true, fault: null };
}

function readLiquidation(feed, asOf, receiveTime, lagThreshold) {
  if (feed === undefined || feed === null) return { ok: false, error: "liquidation feed is not configured" };
  if (!plainObject(feed) || unknownKey(feed, LIQUIDATION_KEYS)) return { ok: false, error: "unsupported field" };
  if (blank(feed.status)) return { ok: false, error: "liquidation feed is not configured" };
  if (typeof feed.status !== "string" || !LIQUIDATION_STATUS.has(feed.status)) {
    return { ok: false, error: "unsupported field" };
  }
  if (feed.events !== undefined && !Array.isArray(feed.events)) return { ok: false, error: "unsupported field" };
  const quality = qualityOf(feed.quality);
  if (!quality.ok) return quality;
  if (feed.status === "outage") return { ok: true, fault: "liquidation-feed outage", reason: "outage" };
  if (!timeValue(feed.eventTime)) return { ok: false, error: "unsupported field" };
  const clock = clockOf(feed, asOf, receiveTime, lagThreshold);
  if (!clock.ok) return clock;
  if (clock.lookahead) return { ok: false, error: "lookahead window" };
  if (!quality.healthy) return { ok: true, fault: "liquidation-feed outage", reason: publicReason(quality.reason) };
  if (clock.stale) return { ok: true, fault: "liquidation-feed outage", reason: clock.reason };
  return { ok: true, fault: null };
}

function published(prediction) {
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    state: null,
    suppressed: false,
    product: "futures",
    score: prediction.score,
    prediction: Object.freeze({ product: "futures", score: prediction.score }),
    spotFallback: false,
    alerts: Object.freeze([]),
  });
}

function suppressed(alerts) {
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    state: predictionState(alerts),
    suppressed: true,
    product: null,
    score: null,
    prediction: null,
    spotFallback: false,
    alerts: Object.freeze(alerts),
  });
}

export function evaluateFuturesFaults(input) {
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS) || missingKey(input)) return fail("unsupported field");
  if (input.spot !== undefined && input.spot !== null && !plainObject(input.spot)) return fail("unsupported field");
  if (!timeValue(input.asOf) || !timeValue(input.receiveTime)) return fail("unsupported field");
  if (input.lagThreshold === undefined || input.lagThreshold === null || input.lagThreshold === "") {
    return fail("lag threshold is not configured");
  }
  if (!timeValue(input.lagThreshold)) return fail("unsupported field");
  const mark = readPrice(input.mark, input.asOf, input.receiveTime, input.lagThreshold);
  if (!mark.ok) return fail(mark.error);
  const index = readPrice(input.index, input.asOf, input.receiveTime, input.lagThreshold);
  if (!index.ok) return fail(index.error);
  const funding = readFunding(input.funding, input.asOf, input.receiveTime, input.lagThreshold);
  if (!funding.ok) return fail(funding.error);
  const openInterest = readOpenInterest(input.openInterest, input.asOf, input.receiveTime, input.lagThreshold);
  if (!openInterest.ok) return fail(openInterest.error);
  const liquidation = readLiquidation(input.liquidationFeed, input.asOf, input.receiveTime, input.lagThreshold);
  if (!liquidation.ok) return fail(liquidation.error);
  const prediction = readPrediction(input.prediction);
  if (!prediction.ok) return fail(prediction.error);
  const alerts = [];
  if (mark.stale) alerts.push(alert("stale mark/index", "mark", mark.reason));
  if (index.stale) alerts.push(alert("stale mark/index", "index", index.reason));
  if (funding.fault) alerts.push(alert(funding.fault, "funding", funding.reason));
  if (openInterest.fault) alerts.push(alert(openInterest.fault, "open interest", null));
  if (liquidation.fault) alerts.push(alert(liquidation.fault, "liquidation", liquidation.reason));
  if (alerts.length > 0) return suppressed(alerts);
  return published(prediction);
}
