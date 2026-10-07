import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as versions from "../services/feature-versions.mjs";
import {
  FEATURE_NULL_POLICY,
  FEATURE_TIMEZONE,
  createFeatureVersionStore,
  readPredictionFeatures,
  recordPredictionFeatures,
  registerFeatureVersion,
  replayFeatures,
} from "../services/feature-versions.mjs";

// Event time 1499865549590 and sequence 28457 are the existing trade fixture.
// Lookback text and source priority are caller fixtures. The source names no duration
// and no venue order. Version id fixture-1 and prediction id prediction-1 are fixtures.
const TIME = 1499865549590;
const FORMULAS = [
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
];

function events(extra) {
  return {
    eventTime: TIME,
    sequence: 28457,
    sequenceWatermark: null,
    quality: { healthy: true, reason: null },
    bidPrice: "0.0025",
    askPrice: "0.0026",
    bidDepth: "4",
    askDepth: "4",
    trades: [
      { side: "buy", quantity: "2.5", price: "0.0026" },
      { side: "sell", quantity: "1", price: "0.0025" },
    ],
    funding: "0.0001",
    openInterest: "12",
    liquidation: "5",
    ...extra,
  };
}

function definition(version, patch) {
  return {
    version,
    features: FORMULAS.map(([name, formula]) => ({
      name,
      formula,
      lookback: "fixture-lookback",
      timezone: FEATURE_TIMEZONE,
      sourcePriority: ["fixture-source"],
      nullPolicy: FEATURE_NULL_POLICY,
      ...(patch ? patch(name, formula) : {}),
    })),
  };
}

function byName(result) {
  return Object.fromEntries(result.features.map((feature) => [feature.name, feature]));
}

test("the same version replays identical events to identical feature output", () => {
  const store = createFeatureVersionStore();
  const registered = registerFeatureVersion(store, definition("fixture-1"));
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.definition.version, "fixture-1");
  assert.equal(registered.definition.features.length, 10);
  assert.equal(registered.definition.features[0].timezone, "UTC");
  assert.equal(registered.definition.features[0].nullPolicy, "missing stays null");
  assert.deepEqual(registered.definition.features[0].sourcePriority, ["fixture-source"]);
  assert.equal(registered.definition.features[3].formula, "NOT IN SOURCE");

  const again = registerFeatureVersion(store, definition("fixture-1"));
  assert.equal(again.ok, true, again.error);
  assert.equal(again.definition.checksum, registered.definition.checksum);

  const first = replayFeatures(store, { version: "fixture-1", events: events() });
  const second = replayFeatures(store, { version: "fixture-1", events: structuredClone(events()) });
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(first.featureVersion, "fixture-1");
  const row = byName(first);
  assert.equal(row.spread.value, "0.0001");
  assert.equal(row.spread.formula, "best ask minus best bid");
  assert.equal(row.spread.eventTime, TIME);
  assert.equal(row.spread.lookback, "fixture-lookback");
  assert.equal(row.spread.timezone, "UTC");
  assert.equal(row.spread.nullPolicy, "missing stays null");
  assert.equal(row["depth imbalance"].value, "0");
  assert.equal(row.CVD.value, "1.5");
  assert.equal(row.VWAP.value, null);
  assert.equal(row.VWAP.formula, "NOT IN SOURCE");
  assert.equal(row.volatility.value, null);
  assert.equal(row["realized range"].value, null);
  assert.equal(row.funding.value, "0.0001");
  assert.equal(row.basis.value, null);
  assert.equal(row.liquidation.value, "5");
  for (const feature of first.features) {
    assert.equal(feature.featureVersion, "fixture-1");
    assert.equal(feature.inputWatermark, TIME);
    assert.equal(feature.eventTime, feature.value === null ? null : TIME);
  }

  const changed = registerFeatureVersion(store, definition("fixture-1", () => ({ lookback: "other-lookback" })));
  assert.equal(changed.ok, false);
  assert.equal(changed.error, "feature version is already registered");
  const kept = replayFeatures(store, { version: "fixture-1", events: events() });
  assert.equal(kept.features[0].lookback, "fixture-lookback");
  assert.deepEqual(kept.features.map((feature) => feature.value), first.features.map((feature) => feature.value));
});

test("a missing version field calculates nothing and a missing input stays missing", () => {
  const store = createFeatureVersionStore();
  const missingLookback = registerFeatureVersion(store, definition("fixture-1", (name) => (
    name === "spread" ? { lookback: "" } : {}
  )));
  assert.equal(missingLookback.error, "lookback is not configured");
  const missingTimezone = registerFeatureVersion(store, definition("fixture-1", (name) => (
    name === "CVD" ? { timezone: "" } : {}
  )));
  assert.equal(missingTimezone.error, "timezone is not configured");
  const localZone = registerFeatureVersion(store, definition("fixture-1", () => ({ timezone: "local" })));
  assert.equal(localZone.error, "timezone is not supported");
  const missingPriority = registerFeatureVersion(store, definition("fixture-1", (name) => (
    name === "funding" ? { sourcePriority: [] } : {}
  )));
  assert.equal(missingPriority.error, "source priority is not configured");
  const missingPolicy = registerFeatureVersion(store, definition("fixture-1", (name) => (
    name === "basis" ? { nullPolicy: "" } : {}
  )));
  assert.equal(missingPolicy.error, "null policy is not configured");
  const zeroPolicy = registerFeatureVersion(store, definition("fixture-1", () => ({ nullPolicy: "zero" })));
  assert.equal(zeroPolicy.error, "null policy is not supported");
  assert.equal(JSON.stringify(zeroPolicy).includes("zero"), false);
  const guessed = registerFeatureVersion(store, definition("fixture-1", (name) => (
    name === "VWAP" ? { formula: "guessed" } : {}
  )));
  assert.equal(guessed.error, "formula is not supported");
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);
  assert.equal(replayFeatures(store, { version: "fixture-1", events: events() }).error, "feature version is not configured");

  const registered = registerFeatureVersion(store, definition("fixture-1"));
  assert.equal(registered.ok, true, registered.error);
  const missing = replayFeatures(store, {
    version: "fixture-1",
    events: events({ bidPrice: undefined, basis: undefined, funding: "0" }),
  });
  assert.equal(missing.ok, true, missing.error);
  assert.equal(byName(missing).spread.value, null);
  assert.equal(byName(missing).basis.value, null);
  assert.equal(byName(missing).funding.value, "0");
  assert.equal(JSON.stringify(byName(missing).spread).includes("\"0\""), false);

  const repeated = replayFeatures(store, {
    version: "fixture-1",
    events: events({ sequenceWatermark: 28457 }),
  });
  const repeatedAgain = replayFeatures(store, {
    version: "fixture-1",
    events: structuredClone(events({ sequenceWatermark: 28457 })),
  });
  assert.equal(repeated.stale, true);
  assert.equal(byName(repeated).spread.value, null);
  assert.deepEqual(repeatedAgain, repeated);
});

test("every stored prediction cites the feature version", () => {
  const store = createFeatureVersionStore();
  registerFeatureVersion(store, definition("fixture-1"));
  registerFeatureVersion(store, definition("fixture-2", () => ({ lookback: "other-lookback" })));
  const recorded = recordPredictionFeatures(store, {
    predictionId: "prediction-1",
    version: "fixture-1",
    events: events(),
  });
  assert.equal(recorded.ok, true, recorded.error);
  assert.equal(recorded.prediction.featureVersion, "fixture-1");
  assert.equal(recorded.prediction.features[0].value, "0.0001");
  const read = readPredictionFeatures(store, { predictionId: "prediction-1" });
  assert.deepEqual(read.prediction, recorded.prediction);

  const duplicate = recordPredictionFeatures(store, {
    predictionId: "prediction-1",
    version: "fixture-1",
    events: events(),
  });
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.equal(duplicate.prediction.featureVersion, "fixture-1");

  const replaced = recordPredictionFeatures(store, {
    predictionId: "prediction-1",
    version: "fixture-2",
    events: events(),
  });
  assert.equal(replaced.ok, false);
  assert.equal(replaced.error, "prediction version is already recorded");
  assert.equal(readPredictionFeatures(store, { predictionId: "prediction-1" }).prediction.featureVersion, "fixture-1");
  assert.equal(readPredictionFeatures(store, { predictionId: "prediction-1" }).prediction.features[0].lookback, "fixture-lookback");

  const absent = recordPredictionFeatures(store, {
    predictionId: "prediction-2",
    version: "missing-version",
    events: events(),
  });
  assert.equal(absent.error, "feature version is not configured");
  assert.equal(readPredictionFeatures(store, { predictionId: "prediction-2" }).error, "prediction is not recorded");
  assert.equal(recordPredictionFeatures(store, { predictionId: "", version: "fixture-1", events: events() }).error, "prediction is not configured");

  const other = recordPredictionFeatures(store, {
    predictionId: "prediction-2",
    version: "fixture-2",
    events: events(),
  });
  assert.equal(other.ok, true, other.error);
  assert.equal(other.prediction.featureVersion, "fixture-2");
  assert.equal(other.prediction.features[0].lookback, "other-lookback");
  assert.deepEqual(
    other.prediction.features.map((feature) => feature.value),
    recorded.prediction.features.map((feature) => feature.value),
  );

  assert.deepEqual(Object.keys(versions).sort(), [
    "FEATURE_DEFINITION_FORMULAS",
    "FEATURE_NULL_POLICY",
    "FEATURE_TIMEZONE",
    "createFeatureVersionStore",
    "readPredictionFeatures",
    "recordPredictionFeatures",
    "registerFeatureVersion",
    "replayFeatures",
  ]);
  assert.equal("placeOrder" in versions, false);
  const source = readFileSync(new URL("../services/feature-versions.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
