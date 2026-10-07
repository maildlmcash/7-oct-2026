import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  BREACH_STATES,
  METRIC_FAMILIES,
  METRIC_FIELDS,
  SYNTHETIC_CHECKS,
  SYNTHETIC_SURFACES,
  TRUTH,
  applySearchReport,
  assignOwner,
  attachTestEvent,
  definitionTable,
  evaluateReading,
  greenReadings,
  percentileOf,
  rateLimitHeadroom,
  readinessView,
  recordSynthetic,
} from "../packages/contracts/src/telemetry/index.mjs";
import { createSearchMetrics } from "../services/search-metrics.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-c-3");
const SECRET = "super-secret-value";
const SAMPLES = [10, 20, 30, 40, 100];

function searchReport(thresholds) {
  const metrics = createSearchMetrics();
  for (const latency of SAMPLES) {
    const recorded = metrics.recordQuery({ latency, error: false });
    assert.equal(recorded.ok, true);
  }
  const observed = metrics.observe({ freshness: 4, queueLag: 0, indexSize: 5 });
  assert.equal(observed.ok, true);
  return metrics.report(thresholds ? { thresholds } : {});
}

test("readiness metrics stay UNKNOWN until target and evidence both exist", async () => {
  const view = readinessView();
  assert.equal(view.truth, TRUTH);
  assert.equal(view.orders, false);
  assert.equal(view.walletAccess, false);
  assert.deepEqual([...METRIC_FAMILIES], ["latency", "uptime", "rate-limit", "security", "device-error"]);
  assert.deepEqual([...BREACH_STATES], ["UNKNOWN", "BREACH", "WITHIN"]);
  assert.deepEqual([...METRIC_FIELDS], ["target", "measured", "limit", "source", "sampleWindow", "breach"]);
  assert.deepEqual(view.metrics.map((row) => row.family), [...METRIC_FAMILIES]);

  const table = definitionTable(view);
  for (const row of table) {
    assert.equal(row.owner, "UNKNOWN");
    assert.equal(row.target, "not configured");
    assert.equal(row.measured, "not measured");
    assert.equal(row.measuredEvidence, null);
    assert.equal(row.limit, "not configured");
    assert.equal(row.sampleWindow, "not configured");
    assert.equal(row.breach, "UNKNOWN");
    assert.equal(typeof row.source, "string");
  }
  assert.deepEqual(greenReadings(view), []);
  assert.equal(JSON.stringify(view).includes("LIVE"), false);
  assert.equal(view.observed.rateLimitHeadroom.breach, "UNKNOWN");
  assert.equal(view.observed.rateLimitHeadroom.measured.note, "rate limit is not configured");
  assert.equal(view.observed.rateLimitHeadroom.measured.value, null);
  for (const name of ["p50", "p95", "p99", "freshness", "disconnects"]) {
    assert.equal(view.observed[name].breach, "UNKNOWN");
    assert.equal(view.observed[name].measured.present, false);
  }
  for (const check of view.observed.securityChecks) {
    assert.equal(check.breach, "UNKNOWN");
    assert.equal(check.measured.present, false);
  }
  assert.equal(view.synthetic.length, SYNTHETIC_SURFACES.length * SYNTHETIC_CHECKS.length);
  for (const row of view.synthetic) assert.equal(row.result, "UNKNOWN");

  const measuredOnly = evaluateReading({
    family: "latency",
    measured: { present: true, value: 30, evidence: "test-event" },
  });
  assert.equal(measuredOnly.ok, true);
  assert.equal(measuredOnly.row.breach, "UNKNOWN");

  const targetOnly = evaluateReading({
    family: "latency",
    target: { configured: true, value: 50 },
  });
  assert.equal(targetOnly.ok, true);
  assert.equal(targetOnly.row.breach, "UNKNOWN");

  const within = evaluateReading({
    family: "latency",
    owner: "Admin",
    target: { configured: true, value: 50 },
    limit: { configured: true, value: 50 },
    sampleWindow: { configured: true, value: 60000 },
    measured: { present: true, value: 30, evidence: "caller-supplied" },
  });
  assert.equal(within.ok, true);
  assert.equal(within.row.breach, "WITHIN");
  assert.equal(within.row.owner, "Admin");

  const breach = evaluateReading({
    family: "latency",
    target: { configured: true, value: 20 },
    measured: { present: true, value: 30, evidence: "caller-supplied" },
  });
  assert.equal(breach.ok, true);
  assert.equal(breach.row.breach, "BREACH");

  const uptime = evaluateReading({
    family: "uptime",
    target: { configured: true, value: 99 },
    measured: { present: true, value: 90, evidence: "caller-supplied" },
  });
  assert.equal(uptime.row.breach, "BREACH");

  const noEvidence = evaluateReading({
    family: "device-error",
    target: { configured: true, value: 0 },
    measured: { present: true, value: 0, evidence: "" },
  });
  assert.equal(noEvidence.row.breach, "UNKNOWN");
  assert.equal(noEvidence.row.measured.present, false);

  const secret = evaluateReading({
    family: "security",
    measured: { present: true, value: 1, evidence: `bearer ${SECRET}` },
  });
  assert.equal(secret.ok, false);
  assert.equal(secret.error, "secret value is not allowed");

  const live = evaluateReading({ family: "uptime", status: "LIVE" });
  assert.equal(live.ok, false);
  assert.equal(live.error, "invalid status");

  const owner = assignOwner(view.metrics[0], "Customer");
  assert.equal(owner.ok, true);
  assert.equal(owner.row.owner, "Customer");
  assert.equal(owner.row.breach, "UNKNOWN");
  const invented = assignOwner(view.metrics[0], "SRE");
  assert.equal(invented.ok, false);
  assert.equal(invented.error, "owner is not a known role");

  const unconfigured = rateLimitHeadroom(null, 0);
  assert.equal(unconfigured.breach, "UNKNOWN");
  assert.equal(unconfigured.note, "rate limit is not configured");
  assert.equal(unconfigured.measured, null);
  const fixtureCap = rateLimitHeadroom({ accountLimit: 30, windowMs: 900000 }, 1);
  assert.equal(fixtureCap.measured, 29);
  assert.equal(fixtureCap.breach, "UNKNOWN");
  assert.match(fixtureCap.note, /no headroom target/);

  const passed = recordSynthetic(view, { surface: "browser", check: "login", result: "PASS", evidence: "test-event" });
  assert.equal(passed.ok, false);
  assert.equal(passed.error, "missing telemetry is UNKNOWN");
  const bareFail = recordSynthetic(view, { surface: "mobile", check: "page", result: "FAIL" });
  assert.equal(bareFail.ok, false);
  assert.equal(bareFail.error, "measured evidence is missing");
  const pageFail = recordSynthetic(view, {
    surface: "mobile",
    check: "page",
    result: "FAIL",
    evidence: "test-event:page",
  });
  assert.equal(pageFail.ok, true);
  const pageRow = pageFail.view.synthetic.find((row) => row.surface === "mobile" && row.check === "page");
  assert.equal(pageRow.result, "FAIL");
  const loginRow = pageFail.view.synthetic.find((row) => row.surface === "browser" && row.check === "login");
  assert.equal(loginRow.result, "UNKNOWN");

  const report = searchReport();
  assert.equal(report.ok, true);
  assert.equal(report.targets.p50.configured, false);
  assert.equal(percentileOf(SAMPLES, 50), report.measured.p50);
  assert.equal(percentileOf(SAMPLES, 95), report.measured.p95);
  assert.equal(percentileOf(SAMPLES, 99), report.measured.p99);
  const applied = applySearchReport(view, report);
  assert.equal(applied.ok, true);
  assert.equal(applied.view.observed.p50.measured.value, report.measured.p50);
  assert.equal(applied.view.observed.p50.breach, "UNKNOWN");
  assert.equal(applied.view.observed.freshness.measured.value, 4);
  assert.equal(applied.view.observed.freshness.breach, "UNKNOWN");
  assert.equal(applied.view.observed.disconnects.breach, "UNKNOWN");

  const over = applySearchReport(view, searchReport({ p95: 40 }));
  assert.equal(over.view.observed.p95.breach, "BREACH");
  assert.equal(over.view.observed.p50.breach, "UNKNOWN");
  const under = applySearchReport(view, searchReport({ p50: 30 }));
  assert.equal(under.view.observed.p50.breach, "WITHIN");
  assert.equal(under.view.observed.p50.target.note, "caller-supplied");

  const event = attachTestEvent(view);
  assert.equal(event.observed.p50.measured.value, 30);
  assert.equal(event.observed.p95.measured.value, 100);
  assert.equal(event.observed.p99.measured.value, 100);
  assert.equal(event.observed.p50.breach, "UNKNOWN");
  assert.equal(event.observed.freshness.breach, "UNKNOWN");
  assert.equal(event.observed.rateLimitHeadroom.breach, "UNKNOWN");
  const device = event.metrics.find((row) => row.family === "device-error");
  assert.equal(device.measured.evidence, "test-event:layout");
  assert.equal(device.breach, "UNKNOWN");
  for (const surface of SYNTHETIC_SURFACES) {
    const layout = event.synthetic.find((row) => row.surface === surface && row.check === "layout");
    assert.equal(layout.result, "FAIL");
    for (const check of ["page", "login", "resend-password"]) {
      const row = event.synthetic.find((item) => item.surface === surface && item.check === check);
      assert.equal(row.result, "UNKNOWN");
    }
  }
  assert.deepEqual(greenReadings(event), []);
  assert.equal(JSON.stringify(event).includes(SECRET), false);
  assert.equal(JSON.stringify(event).includes("LIVE"), false);

  await mkdir(evidenceDir, { recursive: true });
  const definition = {
    task: "1.C.3",
    date: "2026-10-07",
    truth: TRUTH,
    fields: [...METRIC_FIELDS],
    rule: "Missing telemetry is UNKNOWN. UNKNOWN is not a pass. Caller-supplied targets are not product defaults.",
    catalog: table,
    testEvent: definitionTable(event),
    callerSupplied: {
      productDefault: false,
      within: { family: "latency", target: 50, measured: 30, evidence: "caller-supplied", breach: "WITHIN" },
      breach: { family: "latency", target: 20, measured: 30, evidence: "caller-supplied", breach: "BREACH" },
      measuredWithoutTarget: "UNKNOWN",
      targetWithoutMeasured: "UNKNOWN",
    },
  };
  const integration = {
    task: "1.C.3",
    date: "2026-10-07",
    truth: TRUTH,
    samples: SAMPLES,
    searchReport: {
      p50: report.measured.p50,
      p95: report.measured.p95,
      p99: report.measured.p99,
      freshness: report.measured.freshness,
      p50TargetConfigured: false,
      breach: "UNKNOWN",
    },
    callerThreshold: { p95: 40, p95Breach: "BREACH", p50Breach: "UNKNOWN" },
    rateLimit: { note: unconfigured.note, breach: "UNKNOWN" },
    syntheticPassRejected: passed.error,
    greenCatalog: greenReadings(view),
    greenTestEvent: greenReadings(event),
  };
  const body = JSON.stringify(definition);
  const integrationBody = JSON.stringify(integration);
  assert.equal(body.includes(SECRET), false);
  assert.equal(body.includes("LIVE"), false);
  assert.equal(integrationBody.includes(SECRET), false);
  await writeFile(resolve(evidenceDir, "metric-definitions.json"), `${JSON.stringify(definition, null, 2)}\n`);
  await writeFile(resolve(evidenceDir, "integration.json"), `${JSON.stringify(integration, null, 2)}\n`);
});
