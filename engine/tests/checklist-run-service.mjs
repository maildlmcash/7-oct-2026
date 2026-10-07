import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunStore, requestChecklistRun } from "../services/checklist-runs.mjs";

const base = {
  tenantId: 1,
  checklistItemId: 10,
  environment: "local",
  buildSha: "abc123",
  startedAt: "2026-10-06T00:00:00Z",
  endedAt: "2026-10-06T00:05:00Z",
  evidence: ["file://run-evidence"],
};

test("manual and scheduled paths keep run id, environment, build SHA, timestamps, and evidence", () => {
  const store = createRunStore();
  const manual = requestChecklistRun(store, { ...base, path: "manual" });
  const scheduled = requestChecklistRun(store, { ...base, path: "scheduled" });
  assert.equal(manual.ok, true);
  assert.equal(scheduled.ok, true);
  assert.notEqual(manual.run.id, scheduled.run.id);
  assert.equal(manual.run.path, "manual");
  assert.equal(scheduled.run.path, "scheduled");
  assert.equal(manual.run.environment, "local");
  assert.equal(manual.run.buildSha, "abc123");
  assert.equal(manual.run.startedAt, base.startedAt);
  assert.equal(manual.run.endedAt, base.endedAt);
  assert.deepEqual(manual.run.evidence.map((item) => item.url), ["file://run-evidence"]);
  assert.equal(manual.run.result, "NOT_STARTED");
  assert.equal(manual.run.destructiveEnabled, false);
  assert.equal(requestChecklistRun(store, { ...base, path: "on-demand" }).error, "run path must be manual or scheduled");
});

test("a duplicate run request is idempotent", () => {
  const store = createRunStore();
  const first = requestChecklistRun(store, { ...base, path: "manual" });
  const second = requestChecklistRun(store, {
    ...base,
    path: "manual",
    destructive: true,
    evidence: ["file://other"],
  });
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.run.id, first.run.id);
  assert.equal(second.run.evidence.length, 1);
  assert.equal(second.run.evidence[0].id, first.run.evidence[0].id);
  assert.equal(second.run.evidence[0].url, "file://run-evidence");
  assert.equal(second.run.destructiveEnabled, false);
  assert.equal(store.runs.length, 1);

  const later = requestChecklistRun(store, {
    ...base,
    path: "manual",
    startedAt: "2026-10-06T01:00:00Z",
    endedAt: "2026-10-06T01:05:00Z",
  });
  assert.equal(later.idempotentReplay, false);
  assert.notEqual(later.run.id, first.run.id);
});

test("environment and build SHA are required", () => {
  const store = createRunStore();
  assert.equal(
    requestChecklistRun(store, { ...base, path: "scheduled", environment: " " }).error,
    "environment is required",
  );
  assert.equal(
    requestChecklistRun(store, { ...base, path: "manual", buildSha: "" }).error,
    "build SHA is required",
  );
  assert.equal(
    requestChecklistRun(store, { ...base, path: "manual", startedAt: "" }).error,
    "startedAt is required",
  );
  assert.equal(store.runs.length, 0);
});

test("destructive checks stay disabled unless configured for an isolated test environment", () => {
  const store = createRunStore();
  const namedTest = requestChecklistRun(store, {
    ...base,
    path: "scheduled",
    environment: "test",
    destructive: true,
    destructiveChecksConfigured: true,
  });
  assert.equal(namedTest.error, "destructive checks are disabled");

  const configuredOnly = requestChecklistRun(store, {
    ...base,
    path: "scheduled",
    destructive: true,
    destructiveChecksConfigured: true,
    isolatedTestEnvironment: false,
  });
  assert.equal(configuredOnly.error, "destructive checks are disabled");

  const isolatedOnly = requestChecklistRun(store, {
    ...base,
    path: "manual",
    destructive: true,
    isolatedTestEnvironment: true,
  });
  assert.equal(isolatedOnly.error, "destructive checks are disabled");
  assert.equal(store.runs.length, 0);

  const allowed = requestChecklistRun(store, {
    ...base,
    path: "manual",
    environment: "isolated-test",
    destructive: true,
    destructiveChecksConfigured: true,
    isolatedTestEnvironment: true,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.run.destructiveEnabled, true);
  assert.equal(allowed.run.isolatedTestEnvironment, true);
});
