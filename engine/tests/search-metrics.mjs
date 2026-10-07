import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as metricsApi from "../services/search-metrics.mjs";
import { createSearchMetrics } from "../services/search-metrics.mjs";
import { createSearchIndex, indexSearchDocument } from "../services/search-documents.mjs";

// Latency, freshness, and queue lag units are NOT IN SOURCE.
// The series is a load fixture. Nearest rank is the implementation choice.
const LATENCIES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function load(metrics) {
  for (let index = 0; index < LATENCIES.length; index += 1) {
    const recorded = metrics.recordQuery({
      latency: LATENCIES[index],
      error: index >= 8,
    });
    assert.equal(recorded.ok, true, recorded.error);
  }
  const observed = metrics.observe({ freshness: 5, queueLag: 2, indexSize: 1 });
  assert.equal(observed.ok, true, observed.error);
}

test("load fixture report gives p50 p95 p99 and error rate", () => {
  const metrics = createSearchMetrics();
  load(metrics);
  const open = metrics.report();
  assert.equal(open.ok, true);
  assert.equal(open.blocked, null);
  assert.equal(open.universalGuarantees, false);
  assert.equal(open.measured.p50, 50);
  assert.equal(open.measured.p95, 100);
  assert.equal(open.measured.p99, 100);
  assert.equal(open.measured.errors, 2);
  assert.equal(open.measured.samples, 10);
  assert.equal(open.measured.errorRate, "1/5");
  assert.equal(open.measured.freshness, 5);
  assert.equal(open.measured.queueLag, 2);
  assert.equal(open.measured.indexSize, 1);
  assert.equal(open.measured.rejectedDocuments, 0);
  for (const target of Object.values(open.targets)) {
    assert.equal(target.configured, false);
    assert.equal(target.value, null);
  }
  assert.deepEqual(open.alerts, []);

  const tight = metrics.report({
    thresholds: {
      p99: 99,
      errorRate: { numerator: 1, denominator: 10 },
      freshness: 4,
      queueLag: 1,
      indexSize: 0,
      rejectedDocuments: 0,
    },
  });
  assert.equal(tight.measured.p50, 50);
  assert.equal(tight.measured.p99, 100);
  assert.deepEqual(tight.alerts.map((alert) => alert.metric), [
    "p99",
    "errorRate",
    "freshness",
    "queueLag",
    "indexSize",
  ]);
  const loose = metrics.report({
    thresholds: {
      p50: 50,
      p95: 100,
      p99: 100,
      errorRate: { numerator: 1, denominator: 5 },
      freshness: 5,
      queueLag: 2,
      indexSize: 1,
      rejectedDocuments: 0,
    },
  });
  assert.deepEqual(loose.alerts, []);
  assert.equal(loose.targets.p99.configured, true);
  assert.equal(loose.targets.p99.value, 100);
  assert.equal(loose.measured.p99, tight.measured.p99);
});

test("missing measurements and bad thresholds fail closed", () => {
  const empty = createSearchMetrics();
  const missingLoad = empty.report({ thresholds: { p99: 1 } });
  assert.equal(missingLoad.ok, false);
  assert.equal(missingLoad.blocked, "BLOCKED");
  assert.equal(missingLoad.error, "load fixture is required");
  assert.equal(Object.hasOwn(missingLoad, "measured"), false);

  const partial = createSearchMetrics();
  partial.recordQuery({ latency: 10, error: false });
  const missingGauge = partial.report();
  assert.equal(missingGauge.error, "freshness is not measured");

  const bad = createSearchMetrics();
  load(bad);
  assert.equal(bad.report({ thresholds: { p99: 1.5 } }).error, "unsupported field");
  assert.equal(bad.report({ granted: true }).error, "unsupported field");
  assert.equal(bad.recordQuery({ latency: 1, error: false, password: "hunter2" }).error, "unsupported field");
  assert.equal(bad.recordRejection({ document: "hunter2" }).error, "unsupported field");
  const still = bad.report();
  assert.equal(still.ok, true);
  assert.equal(still.measured.samples, 10);
  assert.equal(JSON.stringify(still).includes("hunter2"), false);
});

test("rejected search documents are counted and index size stays the stored count", () => {
  const index = createSearchIndex();
  const metrics = createSearchMetrics();
  const rejected = indexSearchDocument(index, {
    document: {
      kind: "runbook",
      version: "fixture-1",
      title: "Rollback",
      summary: "BEGIN PRIVATE KEY",
      password: "hunter2",
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "sensitive field");
  const counted = metrics.recordRejection();
  assert.equal(counted.rejectedDocuments, 1);
  metrics.recordQuery({ latency: 7, error: true });
  metrics.observe({
    freshness: 0,
    queueLag: 0,
    indexSize: index.documents.length,
  });
  const report = metrics.report({ thresholds: { rejectedDocuments: 0, p99: 7 } });
  assert.equal(report.ok, true);
  assert.equal(report.measured.samples, 1);
  assert.equal(report.measured.p50, 7);
  assert.equal(report.measured.p95, 7);
  assert.equal(report.measured.p99, 7);
  assert.equal(report.measured.errorRate, "1/1");
  assert.equal(report.measured.indexSize, 0);
  assert.equal(report.measured.rejectedDocuments, 1);
  assert.deepEqual(report.alerts.map((alert) => alert.metric), ["rejectedDocuments"]);
  assert.equal(JSON.stringify(report).includes("hunter2"), false);
  assert.equal(JSON.stringify(report).includes("BEGIN PRIVATE KEY"), false);
});

test("paper mode stays locked and the module does not export an order", () => {
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(metricsApi, name), false);
  }
});
