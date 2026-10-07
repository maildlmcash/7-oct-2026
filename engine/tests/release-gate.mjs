import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createFindingLog, recordSignal } from "../services/finding-normalizer.mjs";
import { triageFinding } from "../services/finding-triage.mjs";
import {
  createReleaseGate,
  evaluateReleaseGate,
  recordReleaseRerun,
} from "../services/release-gate.mjs";

const requestId = "11111111-1111-4111-8111-111111111111";
const buildSha = "deadbeef";
const tenantId = "tenant-1";
const admin = { role: "Admin", tenantId };
const evidence = "file://docs/evidence/remediation.txt";
// The source names no numeric threshold. This fixture selects the existing failure statuses.
const threshold = { blockingStatuses: ["FAIL", "BLOCKED"] };

function findingLog() {
  const log = createFindingLog();
  const recorded = recordSignal(log, {
    source: "page-health",
    seenAt: "2026-10-06T00:00:00Z",
    tenantId,
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId,
      buildSha,
    },
  });
  return { log, fingerprint: recorded.finding.fingerprint };
}

test("a critical checklist failure blocks release until remediation and rerun", () => {
  const gate = createReleaseGate();
  const { log, fingerprint } = findingLog();
  assert.equal(log.findings[0].status, "FAIL");
  assert.equal(log.findings[0].severity, null);

  const unconfigured = evaluateReleaseGate(gate, {
    actor: admin,
    tenantId,
    findings: log.findings,
    threshold: null,
    changedAt: "2026-10-06T01:00:00Z",
    patch: "edit apps/web/app/page.tsx",
    deploy: true,
  });
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.blocked, "BLOCKED");
  assert.equal(unconfigured.reason, "release threshold is not configured");
  assert.equal(unconfigured.edited, false);
  assert.equal(unconfigured.deployed, false);

  const blocked = evaluateReleaseGate(gate, {
    actor: admin,
    tenantId,
    findings: log.findings,
    threshold,
    target: fingerprint,
    changedAt: "2026-10-06T01:00:00Z",
    patch: "edit apps/web/app/page.tsx",
    deploy: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, "BLOCKED");
  assert.equal(blocked.reason, "critical checklist failure");
  assert.equal(blocked.edited, false);
  assert.equal(blocked.deployed, false);
  assert.equal(blocked.audit.result, "blocked");
  assert.equal(blocked.audit.configChecksum, null);
  const firstAudit = blocked.audit;

  const remediated = triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "PASS",
    checklistItemId: "item-1",
    owner: "ada",
    evidence,
  });
  assert.equal(remediated.ok, true);
  assert.equal(remediated.finding.severity, null);
  const waiting = evaluateReleaseGate(gate, {
    actor: admin,
    tenantId,
    findings: log.findings,
    threshold,
    target: fingerprint,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(waiting.reason, "rerun is required");
  assert.equal(waiting.blocked, "BLOCKED");

  const rerun = recordReleaseRerun(gate, {
    actor: admin,
    tenantId,
    fingerprint,
    result: "PASS",
    evidence,
    at: "2026-10-06T03:00:00Z",
  });
  assert.equal(rerun.ok, true);
  const passed = evaluateReleaseGate(gate, {
    actor: admin,
    tenantId,
    findings: log.findings,
    threshold,
    target: fingerprint,
    changedAt: "2026-10-06T03:00:00Z",
    deploy: true,
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.result, "passed");
  assert.equal(passed.reason, "release gate passed");
  assert.equal(passed.blocked, null);
  assert.equal(passed.edited, false);
  assert.equal(passed.deployed, false);
  assert.equal(passed.audit.evidence, undefined);
  assert.equal(gate.audits[1], firstAudit);
  assert.equal(firstAudit.reason, "critical checklist failure");
  assert.equal(gate.audits.length, 4);
  assert.throws(() => {
    firstAudit.reason = "passed";
  });
  assert.equal(evaluateReleaseGate(gate, {
    actor: { role: "Customer", tenantId },
    tenantId,
    findings: log.findings,
    threshold,
  }).error, "role scope denied");
  assert.equal(gate.audits.length, 4);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
