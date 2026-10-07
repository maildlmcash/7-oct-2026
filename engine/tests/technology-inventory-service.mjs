import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNKNOWN_FIELD,
  displayRequirementTechnology,
  displayTechnologyTracking,
} from "../services/technology-inventory.mjs";

const checkedAt = "2026-10-06T00:00:00Z";

test("a required dependency found only in a package manifest is FAIL", () => {
  const tracked = displayTechnologyTracking({
    requirementId: "website",
    requiredTechnology: "next",
    requiredVersion: "16.3.8",
    owner: "admin-1",
    evidence: [{ kind: "package", detail: "apps/web/package.json", stale: true }],
    status: "PASS",
    lastCheckedAt: checkedAt,
  });
  assert.equal(tracked.ok, true);
  assert.equal(tracked.display.status, "FAIL");
  assert.equal(tracked.display.detectedUsageEvidence, null);
  assert.equal(tracked.display.requiredTechnology, "next");
  assert.equal(tracked.display.requiredVersion, "16.3.8");
  assert.equal(tracked.display.owner, "admin-1");
  assert.equal(tracked.display.limitSlo, UNKNOWN_FIELD);
  assert.equal(tracked.display.currentMeasurement, UNKNOWN_FIELD);
  assert.notEqual(tracked.display.currentMeasurement, "16.3.8");
  assert.equal(tracked.display.lastCheckedAt, checkedAt);
  assert.equal(tracked.record.packagePresence, true);
  assert.equal(tracked.record.usagePresent, false);
  assert.equal(tracked.record.evidenceStale, false);
});

test("runtime or build evidence can show PASS", () => {
  const runtime = displayTechnologyTracking({
    requirementId: "website",
    requiredTechnology: "next",
    requiredVersion: "16.3.8",
    owner: "admin-1",
    limitSlo: "NOT IN SOURCE",
    currentMeasurement: "process listed next-server",
    lastCheckedAt: checkedAt,
    evidence: [
      { kind: "package", detail: "apps/web/package.json" },
      { kind: "runtime", detail: "next-server is running" },
    ],
  });
  assert.equal(runtime.display.status, "PASS");
  assert.equal(runtime.display.detectedUsageEvidence, "next-server is running");
  assert.equal(runtime.display.limitSlo, "NOT IN SOURCE");
  assert.equal(runtime.display.currentMeasurement, "process listed next-server");
  assert.equal(runtime.record.usageKind, "runtime");

  const build = displayTechnologyTracking({
    requirementId: "website",
    requiredTechnology: "next",
    requiredVersion: "16.3.8",
    evidence: [{ kind: "build", detail: "next build compiled the module" }],
  });
  assert.equal(build.display.status, "PASS");
  assert.equal(build.display.detectedUsageEvidence, "next build compiled the module");
  assert.equal(build.display.owner, UNKNOWN_FIELD);
  assert.equal(build.display.lastCheckedAt, null);
  assert.equal(build.record.usageKind, "build");
});

test("stale runtime or build evidence is UNKNOWN/STALE and an old timestamp is not", () => {
  const stale = displayTechnologyTracking({
    requirementId: "API",
    requiredTechnology: "fastapi",
    requiredVersion: "UNKNOWN",
    lastCheckedAt: checkedAt,
    evidence: [{ kind: "runtime", detail: "old process list", stale: true }],
  });
  assert.equal(stale.display.status, "UNKNOWN/STALE");
  assert.equal(stale.display.detectedUsageEvidence, "old process list");
  assert.equal(stale.display.lastCheckedAt, checkedAt);
  assert.equal(stale.record.evidenceStale, true);

  const oldButNotMarked = displayTechnologyTracking({
    requirementId: "API",
    requiredTechnology: "fastapi",
    requiredVersion: "UNKNOWN",
    lastCheckedAt: "2000-01-01T00:00:00Z",
    evidence: [{ kind: "build", detail: "build log names fastapi" }],
  });
  assert.equal(oldButNotMarked.display.status, "PASS");

  const mixed = displayTechnologyTracking({
    requirementId: "API",
    requiredTechnology: "fastapi",
    requiredVersion: "UNKNOWN",
    evidence: [
      { kind: "runtime", detail: "old process list", stale: true },
      { kind: "build", detail: "fresh build log" },
    ],
  });
  assert.equal(mixed.display.status, "PASS");
  assert.equal(mixed.display.detectedUsageEvidence, "fresh build log");
  assert.equal(mixed.record.usageKind, "build");
});

test("every checklist requirement gets one display row per declared dependency", () => {
  const listed = displayRequirementTechnology([
    {
      requirementId: "website-requirement",
      owner: "admin-1",
      dependencies: [
        {
          requiredTechnology: "next",
          requiredVersion: "16.3.8",
          evidence: [{ kind: "package", detail: "apps/web/package.json" }],
        },
        {
          requiredTechnology: "react",
          requiredVersion: "19.3.0",
          evidence: [{ kind: "runtime", detail: "react render on the page" }],
        },
      ],
    },
  ]);
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.displays.map((row) => [row.requirementId, row.requiredTechnology, row.status, row.owner]),
    [
      ["website-requirement", "next", "FAIL", "admin-1"],
      ["website-requirement", "react", "PASS", "admin-1"],
    ],
  );

  const missing = displayRequirementTechnology([{ requirementId: "empty", dependencies: [] }]);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "required technology is required");
});
