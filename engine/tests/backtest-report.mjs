import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { EXECUTION_NET_RETURN } from "../services/execution-costs.mjs";
import { checksumBacktestReport, reportBacktestPerformance } from "../services/backtest-report.mjs";
import * as report from "../services/backtest-report.mjs";
import {
  WALK_FORWARD_BENCHMARK,
  WALK_FORWARD_BENCHMARK_DIFFERENCE,
  WALK_FORWARD_CALIBRATION,
  WALK_FORWARD_DRAWDOWN,
  WALK_FORWARD_UNCERTAINTY,
} from "../services/walk-forward.mjs";

const manifestIds = {
  datasetId: "fixture-dataset",
  modelVersion: "fixture-model",
  featureVersion: "fixture-features",
};

function windows() {
  return [
    {
      name: "window-loss",
      netReturn: "-517/8500",
      benchmarkNet: "0",
      costReturn: "-517/8500",
      regime: "fixture-loss",
    },
    {
      name: "window-gain",
      netReturn: "1",
      benchmarkNet: "0",
      costReturn: "0",
      regime: "fixture-gain",
    },
  ];
}

function pinned(rows = windows(), ids = manifestIds) {
  const checksum = checksumBacktestReport({ ...ids, windows: rows });
  return {
    manifest: { ...ids, checksum },
    windows: rows,
  };
}

test("every window stays, with benchmark, cost, and a manifest trace", () => {
  const input = pinned();
  const first = reportBacktestPerformance(input);
  const second = reportBacktestPerformance(structuredClone(input));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.sampleSize.value, 2);
  assert.equal(first.windows[0].name, "window-loss");
  assert.equal(first.windows[0].netReturn, "-517/8500");
  assert.equal(first.windows[1].netReturn, "1");
  assert.deepEqual(first.regimes, ["fixture-loss", "fixture-gain"]);
  assert.equal(first.netReturn.value, "7983/8500");
  assert.equal(first.netReturn.formula, "sum of supplied window nets");
  assert.equal(first.benchmark.value, "0");
  assert.equal(first.benchmark.formula, WALK_FORWARD_BENCHMARK);
  assert.equal(first.benchmarkDifference.value, "7983/8500");
  assert.equal(first.benchmarkDifference.formula, WALK_FORWARD_BENCHMARK_DIFFERENCE);
  assert.equal(first.costSensitivity.value, "-517/8500");
  assert.equal(first.costSensitivity.formula, EXECUTION_NET_RETURN);
  assert.equal(first.costSensitivity.assumption, "a cost shock is NOT IN SOURCE");
  assert.equal(first.drawdown.value, null);
  assert.equal(first.drawdown.formula, WALK_FORWARD_DRAWDOWN);
  assert.equal(first.turnover.formula, "NOT IN SOURCE");
  assert.equal(first.exposure.formula, "NOT IN SOURCE");
  assert.equal(first.calibration.formula, WALK_FORWARD_CALIBRATION);
  assert.equal(first.calibration.value, null);
  assert.equal(first.winLoss.formula, "NOT IN SOURCE");
  assert.equal(first.uncertainty.formula, WALK_FORWARD_UNCERTAINTY);
  for (const figure of [
    first.sampleSize,
    first.netReturn,
    first.benchmark,
    first.benchmarkDifference,
    first.costSensitivity,
    first.drawdown,
    first.uncertainty,
  ]) {
    assert.equal(figure.trace.datasetId, "fixture-dataset");
    assert.equal(figure.trace.modelVersion, "fixture-model");
    assert.equal(figure.trace.featureVersion, "fixture-features");
    assert.equal(figure.trace.checksum, input.manifest.checksum);
  }
  assert.deepEqual(second, first);
});

test("a missing manifest, a dropped window, and a bad checksum stay blocked", () => {
  const empty = reportBacktestPerformance({ ...pinned([]), windows: [] });
  assert.equal(empty.blocked, "BLOCKED");
  assert.equal(empty.error, "sample is not configured");
  assert.equal(empty.netReturn, null);
  assert.equal(empty.benchmark, null);
  const untraced = reportBacktestPerformance({ windows: windows() });
  assert.equal(untraced.error, "manifest is not configured");
  assert.equal(untraced.trace, null);
  assert.equal(untraced.netReturn, null);
  assert.equal(JSON.stringify(untraced).includes("7983/8500"), false);
  const dropped = reportBacktestPerformance({ ...pinned(), favorableOnly: true });
  assert.equal(dropped.error, "unsupported field");
  assert.equal(JSON.stringify(dropped).includes("favorableOnly"), false);
  assert.equal(dropped.netReturn, null);
  const noCost = reportBacktestPerformance(pinned([
    { name: "window-gain", netReturn: "1", benchmarkNet: "0", regime: "fixture-gain" },
  ]));
  assert.equal(noCost.error, "cost sensitivity is not configured");
  assert.equal(noCost.costSensitivity, null);
  assert.equal(noCost.netReturn, null);
  const guessed = pinned();
  guessed.manifest.checksum = "g".repeat(64);
  const mismatched = reportBacktestPerformance(guessed);
  assert.equal(mismatched.error, "manifest checksum is not configured");
  assert.equal(JSON.stringify(mismatched).includes("g".repeat(8)), false);
  const wrong = pinned();
  wrong.manifest.checksum = "ab".repeat(32);
  const unmatched = reportBacktestPerformance(wrong);
  assert.equal(unmatched.error, "manifest checksum does not match");
  assert.equal(unmatched.benchmark, null);
  assert.equal(unmatched.netReturn, null);
});

test("the backtest report export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(report).sort(), [
    "checksumBacktestReport",
    "reportBacktestPerformance",
  ]);
  const source = readFileSync(new URL("../services/backtest-report.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WALK_FORWARD_BENCHMARK"), true);
  assert.equal(source.includes("EXECUTION_NET_RETURN"), true);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
