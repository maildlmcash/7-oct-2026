import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { BASELINE_FEATURES, createBaselineStore, registerBaselineModel } from "../services/baseline-model.mjs";
import { readExecutionCost } from "../services/execution-costs.mjs";
import {
  SPOT_HORIZONS,
  createLabelStore,
  labelOutcome,
  registerLabelVersion,
} from "../services/label-definitions.mjs";
import * as walkForward from "../services/walk-forward.mjs";
import {
  WALK_FORWARD_BENCHMARK,
  WALK_FORWARD_BENCHMARK_DIFFERENCE,
  WALK_FORWARD_BRIER,
  WALK_FORWARD_CALIBRATION,
  WALK_FORWARD_CHECKSUM,
  WALK_FORWARD_DRAWDOWN,
  WALK_FORWARD_LOG_LOSS,
  WALK_FORWARD_NET,
  WALK_FORWARD_UNCERTAINTY,
  evaluateWalkForward,
  pinWalkForwardManifest,
} from "../services/walk-forward.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Dead zone 0.01, lag 1000, fee rate 0.001, and the dataset ids are caller fixtures.
// The depth book is decision 0034. The label mids are a separate fixture.
// Regime names and the benchmark series are NOT IN SOURCE.
const TIME = 1499865549590;
const MINUTE = 60000;
const DAY = 86400000;
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

function features(value) {
  const row = {};
  for (const name of BASELINE_FEATURES) row[name] = value;
  return row;
}

function definition(version) {
  return {
    version,
    horizons: [...SPOT_HORIZONS],
    deadZone: "0.01",
    observationWindow: { from: TIME, to: TIME + DAY },
    testWindow: { from: TIME + DAY + 1, to: TIME + DAY + DAY },
  };
}

function stores() {
  const baseline = createBaselineStore();
  registerBaselineModel(baseline, { version: "fixture-baseline" });
  const labels = createLabelStore();
  registerLabelVersion(labels, definition("fixture-label-1"));
  return { baseline, labels };
}

function row(name, fold, cutoff, regime, extra) {
  return {
    name,
    fold,
    regime,
    features: features("1"),
    leakage: {
      receiveTime: cutoff + 1,
      lagThreshold: 1000,
      features: [{
        name: "spread",
        source: "fixture-source",
        eventTime: cutoff,
        window: { from: cutoff, to: cutoff },
        quality: { healthy: true, reason: null },
      }],
    },
    label: {
      cutoff,
      start: { bid: "99", ask: "101", time: cutoff },
      outcome: { bid: "100", ask: "102", time: cutoff + MINUTE },
      quality: { healthy: true, reason: null },
    },
    cost: {
      bids: BIDS.map((level) => [...level]),
      asks: ASKS.map((level) => [...level]),
      quantity: "3",
      feeRate: "0.001",
    },
    benchmarkNet: "0",
    ...extra,
  };
}

function manifest(rows, extra) {
  return {
    datasetId: "fixture-dataset",
    modelVersion: "fixture-baseline",
    featureVersion: "fixture-features",
    labelVersion: "fixture-label-1",
    horizon: "1m",
    window: { from: TIME, to: TIME + DAY },
    folds: [
      { name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME },
      { name: "fold-2", trainEnd: TIME + MINUTE - 1, testStart: TIME + MINUTE, testEnd: TIME + MINUTE },
    ],
    rows,
    ...extra,
  };
}

function evaluate(body, bound = stores()) {
  const pinned = pinWalkForwardManifest(body);
  assert.equal(pinned.ok, true, pinned.error);
  const report = evaluateWalkForward({ ...bound, manifest: pinned.manifest });
  return { bound, pinned, report };
}

test("a pinned manifest reproduces the costed walk-forward report", () => {
  const cost = readExecutionCost({
    bids: BIDS.map((level) => [...level]),
    asks: ASKS.map((level) => [...level]),
    quantity: "3",
    feeRate: "0.001",
  });
  assert.equal(cost.netReturn, "-1051/25500");
  const body = manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
    row("row-2", "fold-2", TIME + MINUTE, "fixture-regime-b"),
  ]);
  const { bound, pinned, report } = evaluate(body);
  const again = evaluateWalkForward({
    ...bound,
    manifest: structuredClone(pinned.manifest),
  });
  assert.equal(report.ok, true, report.error);
  assert.equal(pinned.checksum, report.checksum);
  assert.equal(WALK_FORWARD_CHECKSUM, "sha256");
  assert.equal(report.datasetId, "fixture-dataset");
  assert.equal(report.modelVersion, "fixture-baseline");
  assert.equal(report.featureVersion, "fixture-features");
  assert.equal(report.labelVersion, "fixture-label-1");
  assert.equal(report.horizon, "1m");
  assert.equal(report.sampleSize, 2);
  assert.equal(report.manifestSampleSize, 2);
  assert.equal(report.excludedSampleSize, 0);
  assert.equal(report.netPerformance.formula, WALK_FORWARD_NET);
  assert.equal(report.netPerformance.value, "-398/6375");
  assert.equal(report.netPerformance.mean, "-199/6375");
  assert.equal(report.netPerformance.sampleSize, 2);
  assert.equal(report.netPerformance.costsApplied, true);
  assert.equal(report.netPerformance.uncertainty, null);
  assert.equal(report.netPerformance.uncertaintyFormula, WALK_FORWARD_UNCERTAINTY);
  assert.equal(report.benchmark.formula, WALK_FORWARD_BENCHMARK);
  assert.equal(report.benchmark.value, "0");
  assert.equal(report.benchmarkDifference.formula, WALK_FORWARD_BENCHMARK_DIFFERENCE);
  assert.equal(report.benchmarkDifference.value, "-398/6375");
  assert.equal(report.benchmarkDifference.uncertainty, null);
  assert.equal(report.folds.length, 2);
  assert.equal(report.folds[0].sampleSize, 1);
  assert.equal(report.folds[0].trainEnd, String(TIME - 1));
  assert.equal(report.folds[0].testStart, String(TIME));
  assert.equal(report.folds[0].netPerformance.value, "-199/6375");
  assert.equal(report.folds[0].scores[0].score, "100");
  assert.equal(report.folds[0].scores[0].calibratedProbability, null);
  assert.notEqual(report.folds[0].scores[0].score, report.folds[0].scores[0].calibratedProbability);
  assert.equal(report.folds[1].name, "fold-2");
  assert.equal(report.folds[1].netPerformance.value, "-199/6375");
  assert.deepEqual(report.regimes.map((item) => item.regime), ["fixture-regime-a", "fixture-regime-b"]);
  assert.equal(report.regimes[0].sampleSize, 1);
  assert.equal(report.regimes[0].netPerformance.value, "-199/6375");
  assert.equal(report.brier.value, null);
  assert.equal(report.brier.formula, WALK_FORWARD_BRIER);
  assert.equal(report.brier.sampleSize, 2);
  assert.equal(report.brier.uncertainty, null);
  assert.equal(report.logLoss.value, null);
  assert.equal(report.logLoss.formula, WALK_FORWARD_LOG_LOSS);
  assert.equal(report.drawdown.value, null);
  assert.equal(report.drawdown.formula, WALK_FORWARD_DRAWDOWN);
  assert.equal(report.calibration.formula, WALK_FORWARD_CALIBRATION);
  assert.equal(report.calibration.note, "calibrated probability is not available");
  assert.deepEqual(report.calibration.bins, []);
  assert.equal(report.calibration.sampleSize, 2);
  assert.equal(report.calibration.uncertainty, null);
  assert.deepEqual(again, report);
  assert.equal(JSON.stringify(again), JSON.stringify(report));
  assert.equal(JSON.stringify(report).includes("0.0025"), false);
  assert.equal(JSON.stringify(report).includes("0.001"), false);

  const stored = labelOutcome(bound.labels, {
    version: "fixture-label-1",
    horizon: "1m",
    cutoff: TIME,
    start: { bid: "99", ask: "101", time: TIME },
    outcome: { bid: "100", ask: "102", time: TIME + MINUTE },
    quality: { healthy: true, reason: null },
  });
  assert.equal(stored.return, "0.01");
  assert.equal(stored.costsApplied, false);
  assert.equal(bound.labels.labels.size, 2);
});

test("leakage, unseen folds, and uncertain costs withhold a fabricated net", () => {
  const clean = stores();
  const leakedBody = manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
    row("row-2", "fold-2", TIME + MINUTE, "fixture-regime-b", {
      benchmarkNet: "7",
      leakage: {
        receiveTime: TIME + MINUTE + 1,
        lagThreshold: 1000,
        features: [{
          name: "CVD",
          source: "late-source",
          eventTime: TIME + MINUTE,
          window: { from: TIME + MINUTE, to: TIME + MINUTE + 1 },
          quality: { healthy: true, reason: null },
        }],
      },
    }),
  ]);
  const leaked = evaluate(leakedBody, clean);
  assert.equal(leaked.report.ok, true, leaked.report.error);
  assert.equal(leaked.report.sampleSize, 1);
  assert.equal(leaked.report.manifestSampleSize, 2);
  assert.equal(leaked.report.excludedSampleSize, 1);
  assert.equal(leaked.report.leakage.rows[0].check, "lookahead window");
  assert.equal(leaked.report.leakage.rows[0].feature, "CVD");
  assert.equal(leaked.report.leakage.rows[0].source, "late-source");
  assert.equal(leaked.report.netPerformance.value, "-199/6375");
  assert.equal(leaked.report.benchmark.value, "0");
  assert.equal(JSON.stringify(leaked.report).includes("\"7\""), false);
  assert.equal(clean.labels.labels.size, 1);

  const unseen = pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME, testStart: TIME, testEnd: TIME }],
    rows: [row("row-1", "fold-1", TIME, "fixture-regime-a")],
  }));
  assert.equal(unseen.error, "fold is not unseen");

  const overlap = pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
    row("row-2", "fold-2", TIME + MINUTE, "fixture-regime-b"),
  ], {
    folds: [
      { name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME + MINUTE },
      { name: "fold-2", trainEnd: TIME + MINUTE - 1, testStart: TIME + MINUTE, testEnd: TIME + MINUTE },
    ],
  }));
  assert.equal(overlap.error, "overlapping window");

  const outside = pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a", {
      label: {
        cutoff: TIME + MINUTE,
        start: { bid: "99", ask: "101", time: TIME + MINUTE },
        outcome: { bid: "100", ask: "102", time: TIME + MINUTE + MINUTE },
        quality: { healthy: true, reason: null },
      },
    }),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  }));
  assert.equal(outside.error, "row is outside the folds");

  const swapped = manifest([
    row("row-2", "fold-2", TIME + MINUTE, "fixture-regime-b"),
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
  ]);
  assert.equal(pinWalkForwardManifest(swapped).error, "rows are not time-ordered");
  assert.equal(pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "   "),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  })).error, "regime is not configured");
  assert.equal(pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a", { benchmarkNet: "" }),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  })).error, "benchmark is not configured");

  const guessed = manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a", { benchmarkNet: "guessed" }),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  });
  const badBenchmark = pinWalkForwardManifest(guessed);
  assert.equal(badBenchmark.error, "unsupported field");
  assert.equal(JSON.stringify(badBenchmark).includes("guessed"), false);

  const short = stores();
  const shortRun = evaluate(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a", {
      cost: {
        bids: BIDS.map((level) => [...level]),
        asks: ASKS.map((level) => [...level]),
        quantity: "5",
        feeRate: "0.001",
      },
    }),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  }), short);
  assert.equal(shortRun.report.ok, true, shortRun.report.error);
  assert.equal(shortRun.report.sampleSize, 1);
  assert.equal(shortRun.report.netPerformance.value, null);
  assert.equal(shortRun.report.netPerformance.mean, null);
  assert.equal(shortRun.report.netPerformance.sampleSize, 0);
  assert.equal(shortRun.report.netPerformance.costsApplied, false);
  assert.equal(shortRun.report.netPerformance.note, "depth is not sufficient");
  assert.equal(shortRun.report.benchmark.value, null);
  assert.equal(shortRun.report.benchmarkDifference.value, null);
  assert.equal(shortRun.report.folds[0].scores[0].score, "100");
  assert.equal(JSON.stringify(shortRun.report).includes("-199/6375"), false);
  assert.equal(JSON.stringify(shortRun.report).includes("0.002625"), false);
  assert.equal(short.labels.labels.size, 0);

  const mismatchStore = stores();
  const pinned = pinWalkForwardManifest(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
  }));
  const changed = structuredClone(pinned.manifest);
  changed.rows[0].benchmarkNet = "1";
  const mismatch = evaluateWalkForward({ ...mismatchStore, manifest: changed });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "manifest checksum does not match");
  assert.equal(mismatch.netPerformance, null);
  assert.equal(mismatch.brier, null);
  assert.equal(mismatchStore.labels.labels.size, 0);

  const missingModel = stores();
  const unregistered = evaluate(manifest([
    row("row-1", "fold-1", TIME, "fixture-regime-a"),
  ], {
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
    modelVersion: "missing-version",
  }), missingModel);
  assert.equal(unregistered.report.error, "model version is not configured");
  assert.equal(unregistered.report.sampleSize, null);
});

test("the walk-forward export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(walkForward).sort(), [
    "WALK_FORWARD_BENCHMARK",
    "WALK_FORWARD_BENCHMARK_DIFFERENCE",
    "WALK_FORWARD_BRIER",
    "WALK_FORWARD_CALIBRATION",
    "WALK_FORWARD_CHECKSUM",
    "WALK_FORWARD_DRAWDOWN",
    "WALK_FORWARD_LOG_LOSS",
    "WALK_FORWARD_NET",
    "WALK_FORWARD_UNCERTAINTY",
    "evaluateWalkForward",
    "pinWalkForwardManifest",
  ]);
  assert.equal(WALK_FORWARD_BRIER, "NOT IN SOURCE");
  assert.equal(WALK_FORWARD_LOG_LOSS, "NOT IN SOURCE");
  assert.equal(WALK_FORWARD_DRAWDOWN, "NOT IN SOURCE");
  assert.equal(WALK_FORWARD_UNCERTAINTY, "NOT IN SOURCE");
  const source = readFileSync(new URL("../services/walk-forward.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("NO_TRADE"), false);
  assert.equal(source.includes("ABSTAIN"), false);
  assert.equal(source.includes("S_fut"), false);
  assert.equal(source.includes("Math.log"), false);
  assert.equal(source.includes("Math.exp"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
