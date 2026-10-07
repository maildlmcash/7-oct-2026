import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  attachDiagnostic,
  reproduceFromBundle,
  scanDiagnostic,
} from "../services/diagnostic-bundle.mjs";
import { createFindingLog, recordSignal } from "../services/finding-normalizer.mjs";

const password = "super-secret-value";
const token = "raw-token-secret";
const otp = "otp-secret-value";
const email = "person@example.com";
const requestId = "11111111-1111-4111-8111-111111111111";
const buildSha = "deadbeef";

test("a finding can be reproduced from a sanitized diagnostic bundle", () => {
  const log = createFindingLog();
  const recorded = recordSignal(log, {
    source: "page-health",
    seenAt: "2026-10-06T00:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId,
      buildSha,
    },
  });
  const attached = attachDiagnostic(log, recorded.finding.fingerprint, {
    trace: { requestId, stack: `Error: ${password}` },
    screenshot: { url: "file://docs/evidence/view-state-500.png" },
    request: {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, cookie: password },
      body: { password, otp, accessToken: token, email },
    },
    logs: [
      { result: password, requestId, route: "/api/view-state" },
      { result: `seed phrase ${otp}`, correlationId: requestId },
      { result: "throttled", correlationId: requestId, route: "/api/view-state", httpStatus: 500 },
    ],
    suspectedCause: "a stale build might explain the failure",
    confidence: "high",
    verified: true,
  });
  assert.equal(attached.ok, true);
  assert.equal(scanDiagnostic(attached.finding.bundle).ok, true);
  assert.equal(attached.finding.bundle.hypothesis.label, "hypothesis");
  assert.equal(attached.finding.bundle.hypothesis.verified, false);
  assert.equal(attached.finding.bundle.hypothesis.confidence, null);
  assert.equal(attached.finding.bundle.hypothesis.text, "a stale build might explain the failure");
  assert.equal(attached.finding.bundle.screenshot.url, "file://docs/evidence/view-state-500.png");
  assert.equal(attached.finding.bundle.trace.requestId, requestId);
  assert.deepEqual(attached.finding.bundle.request, {
    method: "GET",
    route: "/api/view-state",
    requestId,
    httpStatus: 500,
  });
  assert.deepEqual(attached.finding.bundle.steps, [
    "GET /api/view-state",
    "Expect HTTP 500",
    `Request id ${requestId}`,
  ]);
  assert.equal(attached.finding.bundle.logs.length, 1);
  assert.equal(attached.finding.bundle.logs[0].result, "throttled");
  const text = JSON.stringify(attached.finding);
  for (const secret of [password, token, otp, email, "Bearer", "seed phrase", "high"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.equal(attached.finding.occurrenceCount, 1);

  const reproduced = reproduceFromBundle(attached.finding.bundle);
  assert.equal(reproduced.ok, true);
  const again = recordSignal(createFindingLog(), reproduced.signal);
  assert.equal(again.ok, true);
  assert.equal(again.finding.fingerprint, recorded.finding.fingerprint);
  assert.equal(again.finding.route, "/api/view-state");
  assert.equal(again.finding.platform, "API");
  assert.equal(again.finding.status, "FAIL");

  const repeated = recordSignal(log, {
    source: "page-health",
    seenAt: "2026-10-06T01:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId,
      buildSha,
    },
  });
  assert.equal(repeated.finding.occurrenceCount, 2);
  assert.equal(repeated.finding.bundle, attached.finding.bundle);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("secret and PII patterns are rejected and a layout bundle still reproduces", () => {
  assert.equal(scanDiagnostic({ password }).ok, false);
  assert.equal(scanDiagnostic({ note: email }).ok, false);
  assert.equal(scanDiagnostic({ note: `Bearer ${token}` }).ok, false);
  assert.equal(scanDiagnostic({ note: "-----BEGIN PRIVATE KEY-----\nabc" }).ok, false);

  const log = createFindingLog();
  const recorded = recordSignal(log, {
    source: "layout",
    seenAt: "2026-10-06T02:00:00Z",
    buildSha,
    finding: {
      surface: "mobile iOS",
      viewport: { name: "mobile", width: 375, height: 667 },
      fault: "overlap",
      evidence: { boxId: "nav", otherBoxId: "panel" },
    },
  });
  const attached = attachDiagnostic(log, recorded.finding.fingerprint, {
    screenshot: { url: `https://example.test/shot.png?token=${token}` },
    suspectedCause: `check the ${email} session`,
    logs: [{ result: "overlap", route: "/api/session/login" }],
  });
  assert.equal(attached.ok, true);
  assert.equal(attached.finding.bundle.screenshot, null);
  assert.equal(attached.finding.bundle.hypothesis.text, null);
  assert.equal(attached.finding.bundle.hypothesis.verified, false);
  assert.deepEqual(attached.finding.bundle.steps, [
    "Check overlap on mobile iOS mobile",
  ]);
  assert.equal(JSON.stringify(attached.finding).includes(token), false);
  assert.equal(JSON.stringify(attached.finding).includes(email), false);
  const reproduced = reproduceFromBundle(attached.finding.bundle);
  const again = recordSignal(createFindingLog(), reproduced.signal);
  assert.equal(again.finding.fingerprint, recorded.finding.fingerprint);
  assert.equal(again.finding.platform, "mobile iOS");
});
