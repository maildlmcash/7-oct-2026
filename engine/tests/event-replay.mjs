import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as replayModule from "../services/event-replay.mjs";
import { EVENT_REPLAY_CHECKSUM, replayEventManifest } from "../services/event-replay.mjs";
import {
  FEATURE_NULL_POLICY,
  FEATURE_TIMEZONE,
  createFeatureVersionStore,
  registerFeatureVersion,
  replayFeatures,
} from "../services/feature-versions.mjs";

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

function definition() {
  return {
    version: "fixture-1",
    features: FORMULAS.map(([name, formula]) => ({
      name,
      formula,
      lookback: "fixture-lookback",
      timezone: FEATURE_TIMEZONE,
      sourcePriority: ["fixture-source"],
      nullPolicy: FEATURE_NULL_POLICY,
    })),
  };
}

function book(extra) {
  return {
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

function event(predictionId, eventTime, sequence, extra) {
  return {
    predictionId,
    schemaVersion: "fixture-schema",
    venue: "fixture-venue",
    product: "Spot",
    symbol: "ETHBTC",
    eventTime,
    receiveTime: eventTime + 1,
    sequence,
    ...book(extra),
  };
}

function store() {
  const featureVersions = createFeatureVersionStore();
  const registered = registerFeatureVersion(featureVersions, definition());
  assert.equal(registered.ok, true, registered.error);
  return featureVersions;
}

function byName(features) {
  return Object.fromEntries(features.map((feature) => [feature.name, feature]));
}

test("two runs of one manifest match checksums and predictions in event-time order", () => {
  const featureVersions = store();
  const manifest = {
    featureVersion: "fixture-1",
    events: [
      event("prediction-late", TIME + 1000, 28458, { receiveTime: TIME + 1001 }),
      event("prediction-early", TIME, 28457, { receiveTime: TIME + 5000 }),
    ],
  };
  const listedFirst = manifest.events[0].predictionId;
  const first = replayEventManifest({ featureVersions, manifest });
  const second = replayEventManifest({
    featureVersions,
    manifest: structuredClone(manifest),
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(manifest.events[0].predictionId, listedFirst);
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.predictions.length, 2);
  assert.deepEqual(second.predictions, first.predictions);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.match(first.checksum, /^[0-9a-f]{64}$/);
  assert.equal(EVENT_REPLAY_CHECKSUM, "sha256");
  assert.equal(first.predictions[0].predictionId, "prediction-early");
  assert.equal(first.predictions[1].predictionId, "prediction-late");
  assert.equal(first.predictions[0].receiveTime, TIME + 5000);
  assert.equal(first.predictions[0].inputWatermark, TIME);
  assert.equal(first.predictions[0].sequenceWatermark, 28457);
  assert.equal(first.predictions[1].sequenceWatermark, 28458);
  assert.equal(first.predictions[0].stale, false);
  assert.equal(first.predictions[0].featureVersion, "fixture-1");
  const row = byName(first.predictions[0].features);
  assert.equal(row.spread.value, "0.0001");
  assert.equal(row.spread.formula, "best ask minus best bid");
  assert.equal(row["depth imbalance"].value, "0");
  assert.equal(row.CVD.value, "1.5");
  assert.equal(row.VWAP.value, null);
  assert.equal(row.funding.value, "0.0001");
  assert.equal(row.basis.value, null);
  assert.equal(row.liquidation.value, "5");
  assert.equal(row.spread.featureVersion, "fixture-1");
  assert.equal(Object.hasOwn(first.predictions[0], "score"), false);
  const direct = replayFeatures(featureVersions, {
    version: "fixture-1",
    events: {
      ...book(),
      eventTime: TIME,
      sequence: 28457,
      sequenceWatermark: null,
    },
  });
  assert.equal(direct.ok, true, direct.error);
  assert.deepEqual(first.predictions[0].features, direct.features);
  assert.equal(first.predictions[0].checksum, direct.checksum);
  const reversed = structuredClone(manifest);
  reversed.events.reverse();
  const third = replayEventManifest({ featureVersions, manifest: reversed });
  assert.equal(third.checksum, first.checksum);
  assert.deepEqual(third.predictions, first.predictions);
  assert.equal(featureVersions.predictions.size, 0);
});

test("a stale sequence, a tie, and a bad event stay deterministic and blocked", () => {
  const featureVersions = store();
  const staleManifest = {
    featureVersion: "fixture-1",
    events: [
      event("prediction-repeat", TIME + 1, 28457),
      event("prediction-first", TIME, 28457),
      event("prediction-gap", TIME + 2, 28459),
    ],
  };
  const stale = replayEventManifest({ featureVersions, manifest: staleManifest });
  const staleAgain = replayEventManifest({
    featureVersions,
    manifest: structuredClone(staleManifest),
  });
  assert.equal(stale.ok, true, stale.error);
  assert.equal(staleAgain.checksum, stale.checksum);
  assert.deepEqual(staleAgain.predictions, stale.predictions);
  assert.equal(stale.predictions[0].predictionId, "prediction-first");
  assert.equal(stale.predictions[0].stale, false);
  assert.equal(byName(stale.predictions[0].features).spread.value, "0.0001");
  assert.equal(stale.predictions[1].predictionId, "prediction-repeat");
  assert.equal(stale.predictions[1].stale, true);
  assert.equal(stale.predictions[1].inputWatermark, null);
  assert.equal(stale.predictions[1].sequenceWatermark, 28457);
  assert.equal(byName(stale.predictions[1].features).spread.value, null);
  assert.equal(stale.predictions[2].predictionId, "prediction-gap");
  assert.equal(stale.predictions[2].stale, false);
  assert.equal(stale.predictions[2].sequenceWatermark, 28459);
  assert.equal(byName(stale.predictions[2].features).spread.value, "0.0001");

  const tied = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [
        event("prediction-high", TIME, 11),
        event("prediction-low", TIME, 10),
      ],
    },
  });
  assert.equal(tied.predictions[0].predictionId, "prediction-high");
  assert.equal(tied.predictions[0].sequenceWatermark, 11);
  assert.equal(tied.predictions[1].stale, true);
  assert.equal(tied.predictions[1].sequenceWatermark, 11);

  const otherSymbol = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [
        event("prediction-eth", TIME, 28457),
        event("prediction-btc", TIME, 28457, { symbol: "BTCUSDT" }),
      ],
    },
  });
  assert.equal(otherSymbol.predictions[0].stale, false);
  assert.equal(otherSymbol.predictions[1].stale, false);
  assert.equal(otherSymbol.predictions[1].symbol, "BTCUSDT");
  assert.equal(otherSymbol.predictions[1].sequenceWatermark, 28457);

  const zero = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [event("prediction-zero", TIME, 0)],
    },
  });
  assert.equal(zero.predictions[0].stale, false);
  assert.equal(zero.predictions[0].sequenceWatermark, 0);

  const wide = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [
        event("prediction-wide-late", "9007199254740993", "9007199254740993"),
        event("prediction-wide-early", "9007199254740992", "9007199254740992"),
      ],
    },
  });
  assert.equal(wide.predictions[0].predictionId, "prediction-wide-early");
  assert.equal(wide.predictions[0].sequenceWatermark, "9007199254740992");
  assert.equal(wide.predictions[1].sequenceWatermark, "9007199254740993");
  assert.equal(wide.predictions[1].stale, false);

  const missingSchema = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [event("prediction-schema", TIME, 28457, { schemaVersion: "" })],
    },
  });
  assert.equal(missingSchema.blocked, "BLOCKED");
  assert.equal(missingSchema.error, "schema version is required");
  assert.equal(missingSchema.predictions, null);
  assert.equal(missingSchema.checksum, null);

  const guessed = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [event("prediction-symbol", TIME, 28457, { symbol: "guessed" })],
    },
  });
  assert.equal(guessed.error, "unsupported field");
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);

  const bookMarker = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [event("prediction-book", TIME, 28457, { bids: "book-marker" })],
    },
  });
  assert.equal(bookMarker.error, "unsupported field");
  assert.equal(JSON.stringify(bookMarker).includes("book-marker"), false);

  const duplicate = replayEventManifest({
    featureVersions,
    manifest: {
      featureVersion: "fixture-1",
      events: [
        event("prediction-same", TIME, 28457),
        event("prediction-same", TIME + 1, 28458),
      ],
    },
  });
  assert.equal(duplicate.error, "prediction version is already recorded");
  assert.equal(duplicate.predictions, null);

  const missingVersion = replayEventManifest({
    featureVersions: createFeatureVersionStore(),
    manifest: {
      featureVersion: "fixture-1",
      events: [event("prediction-missing", TIME, 28457)],
    },
  });
  assert.equal(missingVersion.error, "feature version is not configured");
  assert.equal(missingVersion.predictions, null);
});

test("the event replay export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(replayModule).sort(), [
    "EVENT_REPLAY_CHECKSUM",
    "replayEventManifest",
  ]);
  const source = readFileSync(new URL("../services/event-replay.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("replayFeatures"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("scoreBaselineModel"), false);
  assert.equal(source.includes("scoreFuturesModel"), false);
  for (const path of [
    "../services/feature-versions.mjs",
    "../services/market-features.mjs",
    "../services/baseline-model.mjs",
    "../services/futures-baseline.mjs",
  ]) {
    const body = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(body.includes("replayEventManifest"), false, path);
  }
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
