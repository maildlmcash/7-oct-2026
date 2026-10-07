import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createFindingLog, recordSignal } from "../services/finding-normalizer.mjs";

const password = "super-secret-value";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const buildA = "deadbeef";
const buildB = "cafebabe";

function pageSignal(overrides = {}) {
  return {
    source: "page-health",
    seenAt: "2026-10-06T00:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId: firstId,
      buildSha: buildA,
      severity: password,
      token: password,
    },
    ...overrides,
  };
}

test("repeated identical failures update one finding and keep every occurrence", () => {
  const log = createFindingLog();
  const first = recordSignal(log, pageSignal());
  assert.equal(first.created, true);
  assert.equal(first.finding.severity, null);
  assert.equal(first.finding.status, "FAIL");
  assert.equal(first.finding.route, "/api/view-state");
  assert.equal(first.finding.platform, "API");
  assert.equal(first.finding.affectedBuild, buildA);
  assert.equal(first.finding.firstSeen, "2026-10-06T00:00:00Z");
  assert.equal(first.finding.occurrenceCount, 1);
  assert.equal(JSON.stringify(first.finding).includes(password), false);

  const second = recordSignal(log, pageSignal({
    seenAt: "2026-10-06T01:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId: secondId,
      buildSha: password,
      severity: "critical",
    },
  }));
  assert.equal(second.created, false);
  assert.equal(log.findings.length, 1);
  assert.equal(second.finding.fingerprint, first.finding.fingerprint);
  assert.equal(second.finding.occurrenceCount, 2);
  assert.equal(second.finding.occurrences.length, 2);
  assert.equal(second.finding.occurrences[0], first.finding.occurrences[0]);
  assert.equal(first.finding.occurrences.length, 1);
  assert.equal(second.finding.firstSeen, "2026-10-06T00:00:00Z");
  assert.equal(second.finding.lastSeen, "2026-10-06T01:00:00Z");
  assert.equal(second.finding.affectedBuild, buildA);
  assert.equal(second.finding.occurrences[1].affectedBuild, null);
  assert.equal(second.finding.occurrences[1].requestId, secondId);
  assert.equal(second.finding.status, "FAIL");
  assert.equal(second.finding.severity, null);
  assert.equal(JSON.stringify(second.finding).includes(password), false);

  const earlier = recordSignal(log, pageSignal({
    seenAt: "2026-10-05T23:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId: firstId,
      buildSha: buildB,
    },
  }));
  assert.equal(earlier.finding.occurrenceCount, 3);
  assert.equal(earlier.finding.firstSeen, "2026-10-05T23:00:00Z");
  assert.equal(earlier.finding.lastSeen, "2026-10-06T01:00:00Z");
  assert.equal(earlier.finding.affectedBuild, buildB);
  assert.deepEqual(earlier.finding.occurrences.map((item) => item.affectedBuild), [buildA, null, buildB]);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("distinct root signals stay separate findings", () => {
  const log = createFindingLog();
  recordSignal(log, pageSignal());
  recordSignal(log, pageSignal({
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 400,
      requestId: secondId,
      buildSha: buildA,
    },
  }));
  recordSignal(log, pageSignal({
    event: {
      routeViewId: "section-render",
      viewId: "Market",
      httpStatus: null,
      exception: new Error(password),
      requestId: password,
      buildSha: buildA,
    },
  }));
  const ios = recordSignal(log, {
    source: "layout",
    seenAt: "2026-10-06T02:00:00Z",
    buildSha: buildA,
    finding: {
      surface: "mobile iOS",
      viewport: { name: "mobile", width: 375, height: 667 },
      fault: "overlap",
      evidence: { boxId: "nav", otherBoxId: "panel", token: password },
    },
  });
  const android = recordSignal(log, {
    source: "layout",
    seenAt: "2026-10-06T02:00:00Z",
    buildSha: buildA,
    finding: {
      surface: "mobile Android",
      viewport: { name: "mobile", width: 375, height: 667 },
      fault: "overlap",
      evidence: { boxId: "nav", otherBoxId: "panel" },
    },
  });
  assert.equal(log.findings.length, 5);
  assert.equal(ios.finding.platform, "mobile iOS");
  assert.equal(ios.finding.route, null);
  assert.equal(android.finding.platform, "mobile Android");
  assert.notEqual(ios.finding.fingerprint, android.finding.fingerprint);
  assert.equal(JSON.stringify(log.findings).includes(password), false);
  const surfaces = log.findings.map((finding) => finding.platform);
  assert.deepEqual(surfaces, ["API", "API", "website", "mobile iOS", "mobile Android"]);
  assert.equal(log.findings[2].route, "section-render");
  assert.equal(log.findings[2].occurrences[0].requestId, null);

  const repeat = recordSignal(log, {
    source: "layout",
    seenAt: "2026-10-06T03:00:00Z",
    buildSha: buildB,
    finding: {
      surface: "mobile iOS",
      viewport: { name: "mobile", width: 390, height: 800 },
      fault: "overlap",
      evidence: { boxId: "panel", otherBoxId: "nav" },
    },
  });
  assert.equal(log.findings.length, 5);
  assert.equal(repeat.created, false);
  assert.equal(repeat.finding.occurrenceCount, 2);
  assert.equal(repeat.finding.occurrences[0], ios.finding.occurrences[0]);
  assert.equal(repeat.finding.affectedBuild, buildB);
  assert.equal(recordSignal(log, {
    source: "layout",
    seenAt: "2026-10-06T03:00:00Z",
    finding: { surface: "mobile", viewport: { name: "mobile" }, fault: "overlap", evidence: { boxId: "a", otherBoxId: "b" } },
  }).error, "mobile lists must be separate");
  assert.equal(log.findings.length, 5);
});

test("a successful signal and an unknown source do not create findings", () => {
  const log = createFindingLog();
  assert.equal(recordSignal(log, pageSignal({
    event: { routeViewId: "/api/view-state", httpStatus: 200, requestId: firstId },
  })).error, "signal is not a failure");
  assert.equal(recordSignal(log, { source: "page-health", event: { httpStatus: 500 } }).error, "seen time is required");
  assert.equal(recordSignal(log, { source: "other", seenAt: "2026-10-06T00:00:00Z" }).error, "unknown signal");
  assert.equal(log.findings.length, 0);
  assert.equal(recordSignal(log, pageSignal({
    event: {
      routeViewId: `/api/view-state?token=${password}`,
      httpStatus: 500,
      requestId: firstId,
      buildSha: buildA,
    },
  })).finding.route, null);
});
