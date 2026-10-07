import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { BASELINE_FEATURES, createBaselineStore, registerBaselineModel, scoreBaselineModel } from "../services/baseline-model.mjs";
import {
  FUTURES_FEATURES,
  FUTURES_FORMULA,
  FUTURES_NET,
  FUTURES_PRODUCT,
  createFuturesStore,
  evaluateFuturesWalkForward,
  labelFuturesOutcome,
  pinFuturesManifest,
  registerFuturesLabel,
  registerFuturesModel,
  scoreFuturesModel,
} from "../services/futures-baseline.mjs";
import * as futures from "../services/futures-baseline.mjs";
import { createLabelStore, registerLabelVersion, SPOT_HORIZONS } from "../services/label-definitions.mjs";
import { evaluateWalkForward, pinWalkForwardManifest } from "../services/walk-forward.mjs";

const TIME = 1499865549590;
const DURATION = 60000;
const DAY = 86400000;
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

function signed(value) {
  const row = {};
  for (const name of FUTURES_FEATURES) row[name] = value;
  return row;
}

function artifact(family = "linear") {
  return {
    version: family === "linear" ? "fixture-futures" : "fixture-futures-inverse",
    contractFamily: family,
    horizon: "fixture-horizon",
    duration: DURATION,
  };
}

function leakage(cutoff, windowTo = cutoff) {
  return {
    receiveTime: cutoff + 1,
    lagThreshold: 1000,
    features: [{
      name: "spread",
      source: "fixture-source",
      eventTime: cutoff,
      window: { from: cutoff, to: windowTo },
      quality: { healthy: true, reason: null },
    }],
  };
}

function row(cutoff) {
  return {
    name: "row-1",
    fold: "fold-1",
    regime: "fixture-regime",
    features: signed("1"),
    leakage: leakage(cutoff),
    label: {
      cutoff,
      start: { mark: "100", time: cutoff },
      outcome: { mark: "101", time: cutoff + DURATION },
      quality: { healthy: true, reason: null },
    },
    cost: {
      bids: BIDS.map((level) => [...level]),
      asks: ASKS.map((level) => [...level]),
      quantity: "3",
      feeRate: "0.001",
    },
    funding: "0.01",
    liquidation: "0",
    benchmarkNet: "0",
  };
}

function manifest(rows = [row(TIME)]) {
  return {
    datasetId: "fixture-dataset",
    modelVersion: "fixture-futures",
    featureVersion: "fixture-features",
    labelVersion: "fixture-futures-label",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: DURATION,
    window: { from: TIME, to: TIME + DAY },
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
    rows,
  };
}

function bound() {
  const store = createFuturesStore();
  assert.equal(registerFuturesModel(store, artifact()).ok, true);
  assert.equal(registerFuturesLabel(store, {
    version: "fixture-futures-label",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: DURATION,
  }).ok, true);
  return store;
}

test("a futures artifact scores S_fut and reproduces a funding-aware net", () => {
  const store = bound();
  const allUp = scoreFuturesModel(store, { version: "fixture-futures", features: signed("1") });
  assert.equal(allUp.product, FUTURES_PRODUCT);
  assert.equal(allUp.contractFamily, "linear");
  assert.equal(allUp.formula, FUTURES_FORMULA);
  assert.equal(allUp.score, "100");
  assert.equal(allUp.calibratedProbability, null);
  assert.equal(scoreFuturesModel(store, { version: "fixture-futures", features: signed("-1") }).score, "-100");
  assert.equal(scoreFuturesModel(store, { version: "fixture-futures", features: signed("0") }).score, "0");
  const fundingOnly = signed("0");
  fundingOnly.FundingCrowding = "1";
  assert.equal(scoreFuturesModel(store, { version: "fixture-futures", features: fundingOnly }).score, "14");
  const liquidationOnly = signed("0");
  liquidationOnly.LiquidationFlow = "1";
  assert.equal(scoreFuturesModel(store, { version: "fixture-futures", features: liquidationOnly }).score, "12");
  const clipped = signed("0");
  clipped.PriceTrend = "2";
  assert.equal(scoreFuturesModel(store, { version: "fixture-futures", features: clipped }).score, "18");
  const missing = { ...signed("1") };
  delete missing.FundingCrowding;
  const blocked = scoreFuturesModel(store, { version: "fixture-futures", features: missing });
  assert.equal(blocked.error, "signed feature is missing");
  assert.equal(blocked.score, null);

  const linear = labelFuturesOutcome(store, {
    version: "fixture-futures-label",
    cutoff: TIME,
    start: { mark: "100", time: TIME },
    outcome: { mark: "101", time: TIME + DURATION },
    quality: { healthy: true, reason: null },
  });
  assert.equal(linear.return, "0.01");
  assert.equal(linear.costsApplied, false);
  assert.equal(linear.product, FUTURES_PRODUCT);

  assert.equal(registerFuturesLabel(store, {
    version: "fixture-inverse-label",
    contractFamily: "inverse",
    horizon: "fixture-horizon",
    duration: DURATION,
  }).ok, true);
  const inverse = labelFuturesOutcome(store, {
    version: "fixture-inverse-label",
    cutoff: TIME + DURATION + 1,
    start: { mark: "100", time: TIME + DURATION + 1 },
    outcome: { mark: "110", time: TIME + DURATION + 1 + DURATION },
    quality: { healthy: true, reason: null },
  });
  assert.equal(inverse.contractFamily, "inverse");
  assert.equal(inverse.return, "1/11");

  const pinned = pinFuturesManifest(manifest());
  assert.equal(pinned.ok, true, pinned.error);
  const first = evaluateFuturesWalkForward({ futures: store, manifest: pinned.manifest });
  const second = evaluateFuturesWalkForward({
    futures: store,
    manifest: structuredClone(pinned.manifest),
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.product, FUTURES_PRODUCT);
  assert.equal(first.contractFamily, "linear");
  assert.equal(first.horizon, "fixture-horizon");
  assert.equal(first.duration, String(DURATION));
  assert.equal(first.scores[0].score, "100");
  assert.equal(first.scores[0].calibratedProbability, null);
  assert.equal(first.netPerformance.formula, FUTURES_NET);
  assert.equal(first.netPerformance.value, "-541/25500");
  assert.equal(first.netPerformance.costsApplied, true);
  assert.equal(first.benchmarkDifference.value, "-541/25500");
  assert.equal(first.brier.value, null);
  assert.equal(first.brier.formula, "NOT IN SOURCE");
  assert.equal(first.calibration.bins.length, 0);
  assert.deepEqual(second, first);
  assert.equal(store.labels.get("fixture-futures-label").costsApplied, false);
});

test("spot and futures artifacts stay on separate schemas", () => {
  const store = bound();
  const spotBaseline = createBaselineStore();
  registerBaselineModel(spotBaseline, { version: "fixture-baseline" });
  const spotLabels = createLabelStore();
  registerLabelVersion(spotLabels, {
    version: "fixture-label-1",
    horizons: [...SPOT_HORIZONS],
    deadZone: "0.01",
    observationWindow: { from: TIME, to: TIME + DAY },
    testWindow: { from: TIME + DAY + 1, to: TIME + DAY + DAY },
  });
  const pinned = pinFuturesManifest(manifest());
  assert.equal(pinned.ok, true, pinned.error);

  assert.equal(evaluateFuturesWalkForward({ futures: spotBaseline, manifest: pinned.manifest }).error, "unsupported field");
  assert.equal(evaluateWalkForward({
    baseline: store,
    labels: spotLabels,
    manifest: pinned.manifest,
  }).error, "unsupported field");
  assert.equal(pinWalkForwardManifest(manifest()).error, "unsupported field");
  assert.equal(pinFuturesManifest({
    datasetId: "fixture-dataset",
    modelVersion: "fixture-baseline",
    featureVersion: "fixture-features",
    labelVersion: "fixture-label-1",
    horizon: "1m",
    window: { from: TIME, to: TIME + DAY },
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
    rows: [],
  }).error, "contract family is not configured");
  assert.equal(scoreFuturesModel(store, {
    version: "fixture-futures",
    features: { OBI: "1" },
  }).error, "unsupported field");
  assert.equal(scoreBaselineModel(spotBaseline, {
    version: "fixture-baseline",
    features: signed("1"),
  }).error, "unsupported field");
  assert.equal(registerFuturesModel(spotBaseline, artifact()).error, "unsupported field");
  assert.equal(registerBaselineModel(store, { version: "fixture-futures" }).modelVersion, null);
  assert.equal(labelFuturesOutcome(store, {
    version: "fixture-futures-label",
    cutoff: TIME,
    start: { bid: "99", ask: "101", time: TIME },
    outcome: { mark: "101", time: TIME + DURATION },
    quality: { healthy: true, reason: null },
  }).error, "unsupported field");

  assert.equal(registerFuturesModel(store, artifact("inverse")).ok, true);
  assert.equal(registerFuturesLabel(store, {
    version: "fixture-inverse-label",
    contractFamily: "inverse",
    horizon: "fixture-horizon",
    duration: DURATION,
  }).ok, true);
  const crossed = structuredClone(pinned.manifest);
  crossed.modelVersion = "fixture-futures-inverse";
  crossed.labelVersion = "fixture-futures-label";
  delete crossed.checksum;
  const crossedPin = pinFuturesManifest(crossed);
  assert.equal(evaluateFuturesWalkForward({
    futures: store,
    manifest: crossedPin.manifest,
  }).error, "contract family is not supported");

  const withoutFunding = manifest();
  delete withoutFunding.rows[0].funding;
  assert.equal(pinFuturesManifest(withoutFunding).error, "unsupported field");
  const blankFunding = manifest();
  blankFunding.rows[0].funding = "";
  assert.equal(pinFuturesManifest(blankFunding).error, "funding is not configured");

  const thin = manifest();
  thin.rows[0].cost.quantity = "5";
  const thinPin = pinFuturesManifest(thin);
  const withheld = evaluateFuturesWalkForward({ futures: store, manifest: thinPin.manifest });
  assert.equal(withheld.ok, true, withheld.error);
  assert.equal(withheld.netPerformance.value, null);
  assert.equal(withheld.netPerformance.costsApplied, false);
  assert.equal(withheld.netPerformance.note, "depth is not sufficient");
  assert.equal(withheld.scores[0].score, "100");
  assert.equal(store.outcomes.size, 0);

  const stale = labelFuturesOutcome(store, {
    version: "fixture-futures-label",
    cutoff: TIME + DAY,
    start: { mark: "100", time: TIME + DAY },
    outcome: { mark: "101", time: TIME + DAY + DURATION },
    quality: { healthy: false, reason: "stale stream" },
  });
  assert.equal(stale.error, "stale stream");
  assert.equal(store.outcomes.has(`fixture-futures-label\u0000${TIME + DAY}`), false);
});

test("the futures baseline export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(futures).sort(), [
    "FUTURES_BENCHMARK",
    "FUTURES_BENCHMARK_DIFFERENCE",
    "FUTURES_BRIER",
    "FUTURES_CALIBRATION",
    "FUTURES_CHECKSUM",
    "FUTURES_DRAWDOWN",
    "FUTURES_FEATURES",
    "FUTURES_FORMULA",
    "FUTURES_LABEL",
    "FUTURES_LOG_LOSS",
    "FUTURES_NET",
    "FUTURES_PRODUCT",
    "FUTURES_UNCERTAINTY",
    "FUTURES_WEIGHTS",
    "createFuturesStore",
    "evaluateFuturesWalkForward",
    "labelFuturesOutcome",
    "pinFuturesManifest",
    "registerFuturesLabel",
    "registerFuturesModel",
    "scoreFuturesModel",
  ]);
  const source = readFileSync(new URL("../services/futures-baseline.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes(BASELINE_FEATURES[0]), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
