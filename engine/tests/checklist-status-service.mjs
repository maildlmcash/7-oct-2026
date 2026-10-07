import assert from "node:assert/strict";
import { test } from "node:test";
import { transitionChecklistItem } from "../services/checklist-status.mjs";

const passReady = {
  fromStatus: "IN_PROGRESS",
  toStatus: "PASS",
  hasEvidence: true,
  approver: "approver",
  passExpiry: "2026-10-06T00:00:00Z",
  prerequisites: [],
};

test("rejects statuses outside the task set", () => {
  for (const toStatus of ["READY", "RUNNING", "DONE", ""]) {
    const result = transitionChecklistItem({ ...passReady, toStatus });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid status");
  }
  const fromReady = transitionChecklistItem({ ...passReady, fromStatus: "READY" });
  assert.equal(fromReady.ok, false);
  assert.equal(fromReady.error, "invalid status");
});

test("rejects NOT_APPLICABLE without a reason or an approver", () => {
  const base = { fromStatus: "NOT_STARTED", toStatus: "NOT_APPLICABLE", prerequisites: [] };
  assert.equal(transitionChecklistItem({ ...base, reason: " ", approver: "approver" }).error,
    "NOT_APPLICABLE requires a reason");
  assert.equal(transitionChecklistItem({ ...base, reason: "out of scope" }).error,
    "NOT_APPLICABLE requires an authorized approver");
  assert.equal(transitionChecklistItem({ ...base, reason: "out of scope", approver: " " }).error,
    "NOT_APPLICABLE requires an authorized approver");
  const allowed = transitionChecklistItem({
    ...base,
    reason: "out of scope",
    approver: "approver",
  });
  assert.deepEqual(allowed, { ok: true, status: "NOT_APPLICABLE" });
});

test("rejects PASS without evidence, approver, or expiry", () => {
  assert.equal(transitionChecklistItem({ ...passReady, hasEvidence: false }).error, "PASS requires evidence");
  assert.equal(transitionChecklistItem({ ...passReady, approver: " " }).error, "PASS requires an approver");
  assert.equal(transitionChecklistItem({ ...passReady, passExpiry: null }).error, "PASS requires pass_expiry");
  assert.deepEqual(transitionChecklistItem(passReady), { ok: true, status: "PASS" });
});

test("rejects FAIL and BLOCKED without a linked finding", () => {
  for (const toStatus of ["FAIL", "BLOCKED"]) {
    const missing = transitionChecklistItem({
      fromStatus: "IN_PROGRESS",
      toStatus,
      hasLinkedFinding: false,
      prerequisites: [],
    });
    assert.equal(missing.error, "FAIL or BLOCKED requires a linked finding");
    const allowed = transitionChecklistItem({
      fromStatus: "IN_PROGRESS",
      toStatus,
      hasLinkedFinding: true,
      prerequisites: [],
    });
    assert.equal(allowed.ok, true);
  }
});

test("a dependent task cannot pass while a prerequisite is unresolved", () => {
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "FAIL", "BLOCKED"]) {
    const result = transitionChecklistItem({
      ...passReady,
      prerequisites: [{ status }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "a dependent task cannot pass while a prerequisite is unresolved");
  }
  for (const status of ["PASS", "NOT_APPLICABLE"]) {
    const result = transitionChecklistItem({
      ...passReady,
      prerequisites: [{ status }],
    });
    assert.deepEqual(result, { ok: true, status: "PASS" });
  }
});

test("a BLOCKED prerequisite locks downstream progress", () => {
  const locked = transitionChecklistItem({
    fromStatus: "NOT_STARTED",
    toStatus: "IN_PROGRESS",
    prerequisites: [{ status: "BLOCKED" }],
  });
  assert.equal(locked.ok, false);
  assert.equal(locked.error, "a BLOCKED prerequisite locks the downstream task");

  const open = transitionChecklistItem({
    fromStatus: "NOT_STARTED",
    toStatus: "IN_PROGRESS",
    prerequisites: [{ status: "FAIL" }],
  });
  assert.deepEqual(open, { ok: true, status: "IN_PROGRESS" });
});
