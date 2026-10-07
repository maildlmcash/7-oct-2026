import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as charts from "../services/model-health-charts.mjs";
import {
  MODEL_HEALTH_VIEWS,
  modelHealthLayout,
  readModelHealthChart,
} from "../services/model-health-charts.mjs";

// Edges and the minimum sample size are fixtures. The source names buckets and
// low-sample states, and it names neither the edges nor the minimum.
// Event times are fixtures. Outcome values stay 0 or 1.
const EDGES = ["0", "0.5", "0.8", "1"];
const MINIMUM = 2;

function read(view, extra) {
  const result = readModelHealthChart({ view, ...extra });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.direction, null);
  assert.equal(result.guaranteesDirection, false);
  assert.equal(result.layout.columns, 1);
  assert.equal(result.layout.stack, "column");
  return result;
}

test("known calibration fixtures match the expected bins", () => {
  assert.deepEqual(MODEL_HEALTH_VIEWS, [
    "calibration",
    "brier/log-loss",
    "drift",
    "feature freshness",
    "feed gaps",
    "model/data version",
  ]);

  const mixed = read("calibration", {
    minimumSampleSize: MINIMUM,
    edges: EDGES,
    observations: [
      { eventTime: 1000, probability: "0.25", outcome: "0" },
      { eventTime: 2000, probability: "0.25", outcome: "1" },
      { eventTime: 3000, probability: "0.6", outcome: "0" },
      { eventTime: 4000, probability: "1", outcome: "1" },
    ],
  });
  assert.equal(mixed.formula, "predicted probability buckets vs observed outcome");
  assert.equal(mixed.sampleSize, 4);
  assert.deepEqual(mixed.observedWindow, { from: 1000, to: 4000 });
  assert.equal(mixed.status, "insufficient");
  assert.deepEqual(mixed.bins, [
    {
      low: "0",
      high: "0.5",
      count: 2,
      outcomeCount: 1,
      meanPredicted: "0.25",
      observedRate: "0.5",
      status: "sufficient",
    },
    {
      low: "0.5",
      high: "0.8",
      count: 1,
      outcomeCount: null,
      meanPredicted: null,
      observedRate: null,
      status: "insufficient",
    },
    {
      low: "0.8",
      high: "1",
      count: 1,
      outcomeCount: null,
      meanPredicted: null,
      observedRate: null,
      status: "insufficient",
    },
  ]);

  const boundary = read("calibration", {
    minimumSampleSize: 1,
    edges: EDGES,
    observations: [
      { eventTime: 1000, probability: "0", outcome: "1" },
      { eventTime: 2000, probability: "0.5", outcome: "0" },
      { eventTime: 3000, probability: "0.8", outcome: "1" },
      { eventTime: 4000, probability: "1", outcome: "1" },
    ],
  });
  assert.equal(boundary.bins[0].count, 1);
  assert.equal(boundary.bins[0].low, "0");
  assert.equal(boundary.bins[1].count, 1);
  assert.equal(boundary.bins[1].observedRate, "0");
  assert.equal(boundary.bins[2].count, 2);
  assert.equal(boundary.bins[2].meanPredicted, "0.9");
  assert.equal(boundary.bins[2].observedRate, "1");
  assert.equal(boundary.status, "sufficient");

  const covered = read("calibration", {
    minimumSampleSize: MINIMUM,
    edges: ["0", "1"],
    observations: [
      { eventTime: 1000, probability: "0.25", outcome: "0" },
      { eventTime: 2000, probability: "0.25", outcome: "1" },
    ],
  });
  assert.equal(covered.status, "sufficient");
  assert.equal(covered.bins.length, 1);
  assert.equal(covered.bins[0].count, 2);
  assert.equal(covered.bins[0].meanPredicted, "0.25");
  assert.equal(covered.bins[0].observedRate, "0.5");
  assert.equal(covered.bins[0].status, "sufficient");
});

test("low-sample calibration stays insufficient and is not filled with zero", () => {
  const unset = read("calibration", {});
  assert.equal(unset.sampleSize, 0);
  assert.equal(unset.status, "insufficient");
  assert.equal(unset.note, "bins are not configured");
  assert.equal(unset.observedWindow, null);
  assert.deepEqual(unset.bins, []);

  const noMinimum = read("calibration", {
    edges: ["0", "1"],
    observations: [
      { eventTime: 1000, probability: "0.25", outcome: "1" },
      { eventTime: 2000, probability: "0.75", outcome: "1" },
    ],
  });
  assert.equal(noMinimum.note, "sample size is not configured");
  assert.equal(noMinimum.status, "insufficient");
  assert.equal(noMinimum.bins[0].count, 2);
  assert.equal(noMinimum.bins[0].observedRate, null);
  assert.equal(noMinimum.bins[0].meanPredicted, null);
  assert.equal(noMinimum.bins[0].status, "insufficient");

  const emptyBin = read("calibration", {
    minimumSampleSize: MINIMUM,
    edges: ["0", "0.5", "1"],
    observations: [
      { eventTime: 1000, probability: "0.25", outcome: "0" },
      { eventTime: 2000, probability: "0.25", outcome: "1" },
    ],
  });
  assert.equal(emptyBin.bins[1].count, 0);
  assert.equal(emptyBin.bins[1].status, "insufficient");
  assert.equal(emptyBin.bins[1].observedRate, null);
  assert.equal(JSON.stringify(emptyBin.bins[1]).includes("\"0\""), false);
  assert.equal(emptyBin.status, "insufficient");

  const named = readModelHealthChart({
    view: "calibration",
    edges: EDGES,
    minimumSampleSize: MINIMUM,
    observations: [{ eventTime: 1000, probability: "0.25", outcome: "up" }],
  });
  assert.equal(named.ok, false);
  assert.equal(named.error, "unsupported field");
  assert.equal(named.direction, null);
  assert.equal(JSON.stringify(named).includes("0.25"), false);
  assert.equal(readModelHealthChart({ view: "calibration", minimumSampleSize: 0 }).error, "unsupported field");
  assert.equal(readModelHealthChart({}).error, "view is required");
});

test("history, freshness, gaps, and versions label the window without a direction", () => {
  const history = read("brier/log-loss", {
    bound: 2,
    minimumSampleSize: 2,
    points: [
      { eventTime: 3000, brier: "0.3", logLoss: "0.4" },
      { eventTime: 1000, brier: "0", logLoss: null },
      { eventTime: 2000, brier: "0.2" },
    ],
  });
  assert.equal(history.formula, "NOT IN SOURCE");
  assert.equal(history.sampleSize, 3);
  assert.equal(history.truncated, true);
  assert.equal(history.status, "sufficient");
  assert.deepEqual(history.observedWindow, { from: 1000, to: 3000 });
  assert.deepEqual(history.points, [
    { eventTime: 1000, brier: "0", logLoss: null },
    { eventTime: 2000, brier: "0.2", logLoss: null },
  ]);

  const stale = read("brier/log-loss", {
    bound: 2,
    minimumSampleSize: 2,
    stale: true,
    points: [{ eventTime: 1000, brier: "0.25", logLoss: "0.1" }],
  });
  assert.equal(stale.status, "insufficient");
  assert.deepEqual(stale.points, []);
  assert.equal(JSON.stringify(stale).includes("0.25"), false);

  const drift = read("drift", { bound: 2 });
  assert.equal(drift.formula, "NOT IN SOURCE");
  assert.equal(drift.sampleSize, 0);
  assert.equal(drift.status, "insufficient");
  assert.equal(drift.note, "sample size is not configured");
  assert.equal(readModelHealthChart({ view: "drift" }).error, "bound is required");

  const fresh = read("feature freshness", {
    minimumSampleSize: 1,
    features: [{ name: "spread", watermark: 1000, observedAt: 1500, threshold: 1000 }],
  });
  assert.equal(fresh.sampleSize, 1);
  assert.equal(fresh.records[0].age, "500");
  assert.equal(fresh.records[0].status, "recorded");
  assert.equal(fresh.status, "sufficient");
  assert.deepEqual(fresh.observedWindow, { from: 1500, to: 1500 });

  const unmarked = read("feature freshness", {
    features: [{ name: "spread", watermark: 1500, observedAt: 1000 }],
  });
  assert.equal(unmarked.note, "freshness threshold is not configured");
  assert.equal(unmarked.records[0].age, "-500");
  assert.equal(unmarked.records[0].status, "insufficient");
  assert.equal(unmarked.status, "insufficient");

  const late = read("feature freshness", {
    minimumSampleSize: 1,
    features: [{ name: "spread", watermark: 1000, observedAt: 2500, threshold: 1000 }],
  });
  assert.equal(late.records[0].status, "stale");
  assert.equal(late.status, "insufficient");

  const missingFreshness = read("feature freshness", {});
  assert.equal(missingFreshness.note, "feature freshness is not measured");
  assert.equal(missingFreshness.sampleSize, 0);
  assert.equal(missingFreshness.status, "insufficient");

  const gap = read("feed gaps", {
    minimumSampleSize: 1,
    gaps: [{ from: 1000, to: 2000, reason: "sequence gap" }],
  });
  assert.equal(gap.sampleSize, 1);
  assert.equal(gap.records[0].reason, "sequence gap");
  assert.deepEqual(gap.observedWindow, { from: 1000, to: 2000 });
  assert.equal(gap.status, "sufficient");

  const noGaps = read("feed gaps", {});
  assert.equal(noGaps.note, "feed gaps are not measured");
  assert.equal(noGaps.sampleSize, 0);
  assert.equal(noGaps.status, "insufficient");

  const versions = read("model/data version", {
    modelVersion: "fixture-model",
    dataVersion: "fixture-data",
    featureVersion: "fixture-feature",
    from: 1000,
    to: 4000,
    sampleSize: 4,
    minimumSampleSize: 2,
  });
  assert.equal(versions.modelVersion, "fixture-model");
  assert.equal(versions.dataVersion, "fixture-data");
  assert.equal(versions.featureVersion, "fixture-feature");
  assert.equal(versions.sampleSize, 4);
  assert.deepEqual(versions.observedWindow, { from: 1000, to: 4000 });
  assert.equal(versions.status, "sufficient");

  const unversioned = read("model/data version", {});
  assert.equal(unversioned.note, "model version is not configured");
  assert.equal(unversioned.modelVersion, null);
  assert.equal(unversioned.dataVersion, null);
  assert.equal(unversioned.status, "insufficient");
  assert.equal(unversioned.sampleSize, null);

  for (const width of [375, 768, 1280]) {
    const layout = modelHealthLayout({ width });
    assert.equal(layout.columns, 1);
    assert.equal(layout.stack, "column");
    assert.equal(layout.direction, null);
  }
  assert.equal(modelHealthLayout().width, null);

  assert.deepEqual(Object.keys(charts).sort(), [
    "MODEL_HEALTH_LAYOUT",
    "MODEL_HEALTH_VIEWS",
    "modelHealthLayout",
    "readModelHealthChart",
  ]);
  assert.equal("placeOrder" in charts, false);
  const source = readFileSync(new URL("../services/model-health-charts.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
