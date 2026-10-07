import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as quality from "../services/feature-quality.mjs";
import { checkFeatureQuality } from "../services/feature-quality.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Receive time one millisecond later and lag threshold 1000 are caller fixtures.
// The source names no max event lag. The supplied score is not a model output.
const TIME = 1499865549590;
const RECEIVE = 1499865549591;
const LAG = 1000;

function row(name, source, extra) {
  return {
    name,
    source,
    eventTime: TIME,
    window: { from: TIME, to: TIME },
    quality: { healthy: true, reason: null },
    ...extra,
  };
}

function input(features, extra) {
  return {
    asOf: TIME,
    receiveTime: RECEIVE,
    lagThreshold: LAG,
    features,
    score: "91",
    ...extra,
  };
}

test("the same point-in-time input passes twice and publishes no score", () => {
  const sample = input([
    row("spread", "fixture-source"),
    row("CVD", "fixture-source"),
  ]);
  const first = checkFeatureQuality(sample);
  const second = checkFeatureQuality(structuredClone(sample));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.vetoed, false);
  assert.equal(first.score, null);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(JSON.stringify(first).includes("91"), false);
  assert.deepEqual(first.checked, [
    { feature: "spread", source: "fixture-source" },
    { feature: "CVD", source: "fixture-source" },
  ]);

  const onTime = checkFeatureQuality(input([
    row("funding", "fixture-source", { eventTime: TIME - LAG }),
  ], { receiveTime: TIME }));
  assert.equal(onTime.ok, true, onTime.error);
  assert.equal(onTime.vetoed, false);

  const wide = "9007199254740993";
  const narrow = "9007199254740992";
  const futureDigits = checkFeatureQuality(input([
    row("liquidation", "digit-source", {
      eventTime: wide,
      window: { from: wide, to: wide },
    }),
  ], { asOf: wide, receiveTime: narrow, lagThreshold: "0" }));
  assert.equal(futureDigits.ok, false);
  assert.equal(futureDigits.vetoed, true);
  assert.equal(futureDigits.score, null);
  assert.equal(futureDigits.feature, "liquidation");
  assert.equal(futureDigits.source, "digit-source");
  assert.equal(futureDigits.check, "future timestamp");
  assert.equal(futureDigits.error, "clock skew");
});

test("leakage and stale sources fail closed on the exact feature and source", () => {
  const late = checkFeatureQuality(input([
    row("spread", "fixture-source"),
    row("CVD", "late-source", { eventTime: TIME - LAG - 1 }),
  ]));
  assert.equal(late.ok, false);
  assert.equal(late.blocked, "BLOCKED");
  assert.equal(late.vetoed, true);
  assert.equal(late.score, null);
  assert.equal(late.feature, "CVD");
  assert.equal(late.source, "late-source");
  assert.equal(late.check, "late event");
  assert.equal(late.error, "late event");
  assert.equal(JSON.stringify(late).includes("91"), false);
  assert.equal(JSON.stringify(late).includes("1000"), false);

  const future = checkFeatureQuality(input([
    row("funding", "future-source", { eventTime: RECEIVE + 1 }),
  ], { receiveTime: RECEIVE }));
  assert.equal(future.feature, "funding");
  assert.equal(future.source, "future-source");
  assert.equal(future.check, "future timestamp");
  assert.equal(future.error, "clock skew");
  assert.equal(future.score, null);

  const lookahead = checkFeatureQuality(input([
    row("VWAP", "lookahead-source", { window: { from: TIME, to: TIME + 1 } }),
  ]));
  assert.equal(lookahead.feature, "VWAP");
  assert.equal(lookahead.source, "lookahead-source");
  assert.equal(lookahead.check, "lookahead window");
  assert.equal(lookahead.error, "lookahead window");
  assert.equal(lookahead.vetoed, true);
  assert.equal(lookahead.score, null);

  const laterEvent = checkFeatureQuality(input([
    row("basis", "later-source", { eventTime: TIME + 10 }),
  ], { receiveTime: TIME + 20 }));
  assert.equal(laterEvent.feature, "basis");
  assert.equal(laterEvent.source, "later-source");
  assert.equal(laterEvent.check, "lookahead window");

  const stale = checkFeatureQuality(input([
    row("depth imbalance", "stale-source", {
      quality: { healthy: false, reason: "stale stream" },
    }),
  ]));
  assert.equal(stale.feature, "depth imbalance");
  assert.equal(stale.source, "stale-source");
  assert.equal(stale.check, "invalid source");
  assert.equal(stale.error, "stale stream");
  assert.equal(stale.vetoed, true);
  assert.equal(stale.score, null);

  const degraded = checkFeatureQuality(input([
    row("open interest", "degraded-source", { quality: "degraded" }),
  ]));
  assert.equal(degraded.feature, "open interest");
  assert.equal(degraded.source, "degraded-source");
  assert.equal(degraded.error, "degraded");

  const gap = checkFeatureQuality(input([
    row("liquidation", "gap-source", {
      quality: { healthy: false, reason: "sequence gap" },
    }),
  ]));
  assert.equal(gap.feature, "liquidation");
  assert.equal(gap.source, "gap-source");
  assert.equal(gap.error, "sequence gap");

  const hidden = checkFeatureQuality(input([
    row("spread", "hidden-source", {
      quality: { healthy: false, reason: "secret-reason" },
    }),
  ]));
  assert.equal(hidden.error, "invalid source");
  assert.equal(hidden.feature, "spread");
  assert.equal(hidden.source, "hidden-source");
  assert.equal(JSON.stringify(hidden).includes("secret-reason"), false);

  const missingWindow = checkFeatureQuality(input([
    row("volatility", "window-source", { window: undefined }),
  ]));
  assert.equal(missingWindow.feature, "volatility");
  assert.equal(missingWindow.source, "window-source");
  assert.equal(missingWindow.check, "lookahead window");
  assert.equal(missingWindow.error, "lookahead window is not configured");

  const first = checkFeatureQuality(input([
    row("CVD", "late-source", { eventTime: TIME - LAG - 1 }),
    row("spread", "lookahead-source", { window: { from: TIME, to: TIME + 1 } }),
  ]));
  assert.equal(first.feature, "spread");
  assert.equal(first.source, "lookahead-source");
  assert.equal(first.check, "lookahead window");
});

test("a missing gate publishes no score and the export stays closed", () => {
  const missingLag = checkFeatureQuality({
    asOf: TIME,
    receiveTime: RECEIVE,
    features: [row("spread", "fixture-source")],
    score: "91",
  });
  assert.equal(missingLag.ok, false);
  assert.equal(missingLag.vetoed, true);
  assert.equal(missingLag.score, null);
  assert.equal(missingLag.error, "lag threshold is not configured");
  assert.equal(JSON.stringify(missingLag).includes("91"), false);

  const missingDecision = checkFeatureQuality({
    receiveTime: RECEIVE,
    lagThreshold: LAG,
    features: [row("spread", "fixture-source")],
  });
  assert.equal(missingDecision.error, "decision time is not configured");
  assert.equal(missingDecision.score, null);

  const missingReceive = checkFeatureQuality({
    asOf: TIME,
    lagThreshold: LAG,
    features: [row("spread", "fixture-source")],
  });
  assert.equal(missingReceive.error, "receive time is required");

  const missingQuality = checkFeatureQuality(input([
    row("realized range", "quality-source", { quality: undefined }),
  ]));
  assert.equal(missingQuality.feature, "realized range");
  assert.equal(missingQuality.source, "quality-source");
  assert.equal(missingQuality.check, "invalid source");
  assert.equal(missingQuality.error, "source quality is not configured");

  const blankSource = checkFeatureQuality(input([
    row("spread", ""),
  ]));
  assert.equal(blankSource.feature, "spread");
  assert.equal(blankSource.error, "source is not configured");
  assert.equal(blankSource.score, null);

  const unknown = checkFeatureQuality(input([
    row("guessed", "fixture-source"),
  ]));
  assert.equal(unknown.error, "unsupported field");
  assert.equal(unknown.feature, null);
  assert.equal(unknown.source, null);
  assert.equal(JSON.stringify(unknown).includes("guessed"), false);

  assert.equal(checkFeatureQuality({}).error, "decision time is not configured");
  assert.deepEqual(Object.keys(quality).sort(), [
    "FEATURE_QUALITY_CHECKS",
    "checkFeatureQuality",
  ]);
  assert.deepEqual(quality.FEATURE_QUALITY_CHECKS, [
    "late event",
    "future timestamp",
    "lookahead window",
    "invalid source",
  ]);
  assert.equal("placeOrder" in quality, false);
  const source = readFileSync(new URL("../services/feature-quality.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("S_spot"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
