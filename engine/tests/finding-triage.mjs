import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { attachDiagnostic } from "../services/diagnostic-bundle.mjs";
import { triageFinding, viewFinding } from "../services/finding-triage.mjs";
import { createFindingLog, recordSignal } from "../services/finding-normalizer.mjs";

const password = "super-secret-value";
const requestId = "11111111-1111-4111-8111-111111111111";
const buildSha = "deadbeef";
const tenantId = "tenant-1";
const admin = { role: "Admin", tenantId };
const customer = { role: "Customer", tenantId };

function logWithFinding() {
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
    tenantId,
  });
  return { log, recorded };
}

test("a status change requires an admin and remediation evidence", () => {
  const { log, recorded } = logWithFinding();
  const fingerprint = recorded.finding.fingerprint;
  assert.equal(triageFinding(log, {
    actor: customer,
    tenantId,
    fingerprint,
    status: "IN_PROGRESS",
    evidence: "file://docs/evidence/remediation.txt",
  }).error, "role scope denied");
  assert.equal(triageFinding(log, {
    actor: { role: "Super Admin", tenantId },
    tenantId,
    fingerprint,
    status: "IN_PROGRESS",
    evidence: "file://docs/evidence/remediation.txt",
  }).error, "role scope denied");
  assert.equal(triageFinding(log, {
    actor: { role: "Admin", tenantId: "tenant-2" },
    tenantId: "tenant-2",
    fingerprint,
    status: "IN_PROGRESS",
    evidence: "file://docs/evidence/remediation.txt",
  }).error, "role scope denied");
  assert.equal(triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "IN_PROGRESS",
  }).error, "status transition requires evidence");
  assert.equal(recorded.finding.status, "FAIL");

  const triaged = triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "IN_PROGRESS",
    owner: "ada",
    dueDate: "2026-10-20T00:00:00Z",
    checklistItemId: "item-1",
    severity: password,
    evidence: { url: "file://docs/evidence/remediation.txt" },
  });
  assert.equal(triaged.ok, true);
  assert.equal(triaged.finding.status, "IN_PROGRESS");
  assert.equal(triaged.finding.owner, "ada");
  assert.equal(triaged.finding.dueDate, "2026-10-20T00:00:00Z");
  assert.equal(triaged.finding.checklistItemId, "item-1");
  assert.equal(triaged.finding.severity, null);
  assert.equal(triaged.finding.remediationEvidence[0].url, "file://docs/evidence/remediation.txt");
  assert.equal(JSON.stringify(triaged.finding).includes(password), false);
  assert.equal(triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "READY",
    evidence: "file://docs/evidence/remediation.txt",
  }).error, "invalid status");
  assert.equal(log.findings[0].status, "IN_PROGRESS");
});

test("resolving a finding keeps the raw bundle and admin and user views differ", () => {
  const { log, recorded } = logWithFinding();
  const fingerprint = recorded.finding.fingerprint;
  const attached = attachDiagnostic(log, fingerprint, {
    trace: { requestId },
    suspectedCause: "a stale build might explain the failure",
    screenshot: { url: "file://docs/evidence/view-state-500.png" },
  });
  const bundle = attached.finding.bundle;
  const raw = JSON.stringify(bundle);
  assert.equal(triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "PASS",
    evidence: "file://docs/evidence/remediation.txt",
  }).error, "checklist item is required");
  const resolved = triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "PASS",
    checklistItemId: "item-1",
    owner: "ada",
    evidence: "file://docs/evidence/remediation.txt",
    bundle: { tampered: password },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.finding.bundle, bundle);
  assert.equal(JSON.stringify(resolved.finding.bundle), raw);
  assert.equal(resolved.finding.status, "PASS");
  const again = triageFinding(log, {
    actor: admin,
    tenantId,
    fingerprint,
    status: "NOT_APPLICABLE",
    evidence: "file://docs/evidence/remediation-2.txt",
  });
  assert.equal(again.ok, true);
  assert.equal(again.finding.remediationEvidence[0], resolved.finding.remediationEvidence[0]);
  assert.deepEqual(again.finding.remediationEvidence.map((item) => item.url), [
    "file://docs/evidence/remediation.txt",
    "file://docs/evidence/remediation-2.txt",
  ]);
  assert.equal(again.finding.bundle, bundle);

  const adminView = viewFinding(log, { actor: admin, tenantId, fingerprint });
  const userView = viewFinding(log, { actor: customer, tenantId, fingerprint });
  assert.equal(adminView.view.canEdit, true);
  assert.equal(adminView.view.bundle, bundle);
  assert.equal(userView.view.canEdit, false);
  assert.equal(Object.hasOwn(userView.view, "bundle"), false);
  assert.equal(userView.view.status, "NOT_APPLICABLE");
  assert.equal(userView.view.owner, "ada");
  assert.equal(userView.view.severity, null);
  assert.equal(userView.view.checklistItemId, "item-1");
  assert.equal(userView.view.remediationEvidence.length, 2);
  assert.equal(JSON.stringify(userView.view).includes("stale build"), false);
  assert.equal(viewFinding(log, {
    actor: { role: "Distributor", tenantId },
    tenantId,
    fingerprint,
  }).error, "role scope denied");
  assert.equal(viewFinding(log, {
    actor: { role: "Admin", tenantId: "tenant-2" },
    tenantId: "tenant-2",
    fingerprint,
  }).error, "role scope denied");

  const repeated = recordSignal(log, {
    source: "page-health",
    seenAt: "2026-10-06T03:00:00Z",
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId,
      buildSha,
    },
  });
  assert.equal(repeated.finding.occurrenceCount, 2);
  assert.equal(repeated.finding.status, "NOT_APPLICABLE");
  assert.equal(repeated.finding.owner, "ada");
  assert.equal(repeated.finding.checklistItemId, "item-1");
  assert.equal(repeated.finding.bundle, bundle);
  assert.equal(repeated.finding.remediationEvidence.length, 2);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
