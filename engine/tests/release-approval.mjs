import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { canEditChecklist } from "../services/checklist-status-view.mjs";
import * as approval from "../services/release-approval.mjs";
import {
  RELEASE_APPROVAL_AREAS,
  RELEASE_APPROVAL_LIMITATIONS,
  createReleaseChecklist,
  exportReleaseBundle,
  openReleaseChecklist,
  recordReleaseApproval,
} from "../services/release-approval.mjs";

const WHEN = "2026-10-07T00:00:00Z";
const MAKER = { id: "fixture-maker", role: "Admin", tenantId: "tenant-a" };
const CUSTOMER = { id: "fixture-customer", role: "Customer", tenantId: "tenant-a" };
const OTHER = { id: "fixture-admin-b", role: "Admin", tenantId: "tenant-b" };
const APPROVERS = Object.freeze([
  ["security", "fixture-security", "fixture-evidence-security"],
  ["data quality", "fixture-data", "fixture-evidence-data"],
  ["model", "fixture-model", "fixture-evidence-model"],
  ["operations", "fixture-operations", "fixture-evidence-operations"],
  ["business-policy", "fixture-business", "fixture-evidence-business"],
]);

function approver(id) {
  return { id, role: "Admin", tenantId: "tenant-a" };
}

function approve(store, releaseId, area, id, evidence, changedAt = WHEN) {
  return recordReleaseApproval(store, {
    actor: approver(id),
    tenantId: "tenant-a",
    releaseId,
    area,
    evidence,
    changedAt,
  });
}

test("a release stays blocked without an independent approver", () => {
  const store = createReleaseChecklist();
  const opened = openReleaseChecklist(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    kind: "paper",
    changedAt: WHEN,
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.blocked, "BLOCKED");
  assert.equal(opened.result, "blocked");
  assert.equal(opened.error, "security approval is not recorded");
  assert.equal(opened.liveTrading, "OFF");
  assert.equal(opened.liveOrdersLocked, true);
  assert.equal(opened.liveEnabled, false);
  assert.equal(opened.deployed, false);
  assert.equal(opened.promoted, false);
  assert.equal(store.approvals.length, 0);

  const exported = exportReleaseBundle(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
  });
  assert.equal(exported.blocked, "BLOCKED");
  assert.equal(exported.bundle.releaseId, "fixture-release");
  assert.equal(exported.bundle.result, "blocked");
  assert.equal(exported.bundle.areas[0].area, "security");
  assert.equal(exported.bundle.areas[0].approverId, null);
  assert.equal(exported.bundle.areas[5].area, "live-trading");
  assert.equal(exported.bundle.areas[5].applicable, false);
  assert.equal(typeof exported.bundle.checksum, "string");
  assert.equal(exported.bundle.checksum.length, 64);
  assert.equal(JSON.stringify(exported.bundle).includes("PASS"), false);
  const again = exportReleaseBundle(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
  });
  assert.equal(again.bundle.checksum, exported.bundle.checksum);
  assert.equal(store.audits.length, 1);

  const generated = recordReleaseApproval(store, {
    actor: approver("fixture-security"),
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    area: "security",
    evidence: "fixture-evidence-security",
    changedAt: WHEN,
    status: "PASS",
  });
  assert.equal(generated.error, "system pass is not an approver");
  assert.equal(JSON.stringify(generated).includes("PASS"), false);
  assert.equal(store.approvals.length, 0);

  const days = openReleaseChecklist(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release-days",
    kind: "paper",
    changedAt: WHEN,
    paperDays: 28,
  });
  assert.equal(days.error, "paper day count is NOT IN SOURCE");
  assert.equal(Object.hasOwn(days, "paperDays"), false);
  assert.equal(store.checklists.length, 1);

  const maker = approve(store, "fixture-release", "security", "fixture-maker", "fixture-evidence-security");
  assert.equal(maker.error, "maker cannot approve");
  assert.equal(store.approvals.length, 0);

  const security = approve(store, "fixture-release", "security", "fixture-security", "fixture-evidence-security");
  assert.equal(security.ok, false);
  assert.equal(security.error, "data quality approval is not recorded");
  assert.equal(security.approvalCount, 1);
  const repeated = approve(store, "fixture-release", "data quality", "fixture-security", "fixture-evidence-data");
  assert.equal(repeated.error, "approvers are not distinct");
  assert.equal(store.approvals.length, 1);
  assert.equal(store.approvals[0].area, "security");
});

test("recorded human approvals export without enabling live trading", () => {
  const store = createReleaseChecklist();
  openReleaseChecklist(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    kind: "paper",
    changedAt: WHEN,
  });
  for (const [area, id, evidence] of APPROVERS) {
    const recorded = approve(store, "fixture-release", area, id, evidence);
    assert.equal(recorded.error, area === "business-policy" ? null : APPROVERS[APPROVERS.findIndex((row) => row[0] === area) + 1][0] + " approval is not recorded");
  }
  const paper = exportReleaseBundle(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
  });
  assert.equal(paper.ok, true);
  assert.equal(paper.blocked, null);
  assert.equal(paper.result, "approved");
  assert.equal(paper.liveTrading, "OFF");
  assert.equal(paper.liveOrdersLocked, true);
  assert.equal(paper.liveEnabled, false);
  assert.equal(paper.deployed, false);
  assert.equal(paper.approvalCount, 5);
  assert.equal(paper.bundle.areas[4].approverId, "fixture-business");
  assert.equal(paper.bundle.areas[5].applicable, false);
  assert.equal(JSON.stringify(paper.bundle).includes("PASS"), false);
  assert.equal(store.approvals.length, 5);
  const replay = approve(store, "fixture-release", "security", "fixture-security", "fixture-evidence-security");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.ok, true);
  assert.equal(store.approvals.length, 5);

  openReleaseChecklist(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-live",
    kind: "live",
    changedAt: WHEN,
  });
  for (const [area, id, evidence] of APPROVERS) {
    const recorded = approve(store, "fixture-live", area, id, evidence);
    assert.equal(recorded.ok, false, area);
  }
  const missingLive = exportReleaseBundle(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-live",
  });
  assert.equal(missingLive.blocked, "BLOCKED");
  assert.equal(missingLive.error, "live-trading approval is not recorded");
  assert.equal(missingLive.bundle.areas[5].applicable, true);
  const live = approve(store, "fixture-live", "live-trading", "fixture-live", "fixture-evidence-live");
  assert.equal(live.ok, false);
  assert.equal(live.blocked, "BLOCKED");
  assert.equal(live.error, "live orders are locked");
  assert.equal(live.liveEnabled, false);
  assert.equal(live.liveTrading, "OFF");
  assert.equal(live.deployed, false);
  const liveBundle = exportReleaseBundle(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-live",
  });
  assert.equal(liveBundle.bundle.result, "blocked");
  assert.equal(liveBundle.bundle.reason, "live orders are locked");
  assert.equal(liveBundle.bundle.areas[5].approverId, "fixture-live");
  assert.equal(JSON.stringify(liveBundle.bundle).includes("PASS"), false);
  assert.equal(store.audits.filter((row) => row.target === "fixture-live").length, 7);
});

test("approval records stay inside the tenant and do not deploy", () => {
  const store = createReleaseChecklist();
  const denied = openReleaseChecklist(store, {
    actor: CUSTOMER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    kind: "paper",
    changedAt: WHEN,
  });
  assert.equal(denied.error, "role scope denied");
  assert.equal(store.checklists.length, 0);
  const outside = recordReleaseApproval(store, {
    actor: OTHER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    area: "security",
    evidence: "fixture-evidence-security",
    changedAt: WHEN,
  });
  assert.equal(outside.error, "role scope denied");
  assert.equal(store.approvals.length, 0);

  openReleaseChecklist(store, {
    actor: MAKER,
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    kind: "paper",
    changedAt: WHEN,
  });
  const secret = approve(store, "fixture-release", "security", "fixture-security", "bearer fixture-token");
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(store.approvals.length, 0);
  const credential = recordReleaseApproval(store, {
    actor: approver("fixture-security"),
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    area: "security",
    evidence: "fixture-evidence-security",
    changedAt: WHEN,
    apiKey: "fixture-key",
  });
  assert.equal(credential.error, "live credentials are not allowed");
  assert.equal(JSON.stringify(credential).includes("fixture-key"), false);
  const outcomes = recordReleaseApproval(store, {
    actor: approver("fixture-security"),
    tenantId: "tenant-a",
    releaseId: "fixture-release",
    area: "security",
    evidence: "fixture-evidence-security",
    changedAt: WHEN,
    outcomeCount: 200,
  });
  assert.equal(outcomes.error, "outcome count is NOT IN SOURCE");
  assert.equal(store.approvals.length, 0);
  const skipped = approve(store, "fixture-release", "live-trading", "fixture-live", "fixture-evidence-live");
  assert.equal(skipped.error, "approval area is not applicable");
  assert.equal(store.approvals.length, 0);
  const unknown = approve(store, "fixture-release", "fixture-area", "fixture-security", "fixture-evidence-security");
  assert.equal(unknown.error, "approval area is not configured");
  assert.equal(JSON.stringify(unknown).includes("fixture-area"), false);

  assert.equal(canEditChecklist(CUSTOMER, "tenant-a"), false);
  assert.equal(canEditChecklist(MAKER, "tenant-a"), true);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveOrdersLocked = false;
  });
  assert.equal(health.liveOrdersLocked, true);
  const source = readFileSync(new URL("../services/release-approval.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("Math.round"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("evaluateReleaseGate"), false);
  assert.equal(source.includes("recordRolloutStage"), false);
  assert.deepEqual(RELEASE_APPROVAL_AREAS, [
    "security",
    "data quality",
    "model",
    "operations",
    "business-policy",
  ]);
  assert.equal(RELEASE_APPROVAL_LIMITATIONS.includes("a system pass is not an approver"), true);
  assert.deepEqual(Object.keys(approval), [
    "RELEASE_APPROVAL_AREAS",
    "RELEASE_APPROVAL_LIMITATIONS",
    "createReleaseChecklist",
    "exportReleaseBundle",
    "openReleaseChecklist",
    "recordReleaseApproval",
  ]);
});
