import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHECKLIST_AREAS,
  assertAreaCoverage,
  createProjectChecklists,
  createTemplate,
  createTemplateStore,
  readTemplateHistory,
  retireTemplate,
  updateTemplate,
} from "../services/checklist-templates.mjs";

const project = { id: 10, tenantId: 1 };
const otherProject = { id: 11, tenantId: 2 };
const admin = { id: "admin-1", role: "Admin", tenantId: 1 };
const otherAdmin = { id: "admin-2", role: "Admin", tenantId: 2 };

function entry(areaPlatform) {
  return {
    areaPlatform,
    requirement: `${areaPlatform} requirement`,
    testMethod: "inspect",
    expectedValue: "present",
    version: "1",
  };
}

test("roles other than Admin are denied, including another tenant", () => {
  const store = createTemplateStore();
  const roles = [
    "Super Admin",
    "Super Distributor",
    "Distributor",
    "Retailer",
    "Customer",
  ];
  for (const role of roles) {
    const result = createTemplate(store, {
      actor: { id: role, role, tenantId: 1 },
      project,
      ...entry("website"),
      changedAt: "2026-10-06T00:00:00Z",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "role scope denied");
  }
  const crossTenant = createTemplate(store, {
    actor: otherAdmin,
    project,
    ...entry("website"),
    changedAt: "2026-10-06T00:00:00Z",
  });
  assert.equal(crossTenant.error, "role scope denied");
  assert.equal(store.templates.length, 0);
  assert.equal(store.audits.length, 0);
});

test("mobile iOS and mobile Android stay separate lists", () => {
  assert.equal(assertAreaCoverage(["mobile"]).error, "mobile lists must be separate");
  assert.equal(
    assertAreaCoverage(["mobile iOS", "mobile Android"]).error,
    "project checklist must cover each area once",
  );
  const combined = [...CHECKLIST_AREAS.filter((area) => area !== "mobile Android"), "mobile"];
  assert.equal(assertAreaCoverage(combined).error, "mobile lists must be separate");

  const store = createTemplateStore();
  const created = createProjectChecklists(store, {
    actor: admin,
    project,
    changedAt: "2026-10-06T00:00:00Z",
    entries: CHECKLIST_AREAS.map(entry),
  });
  assert.equal(created.ok, true);
  assert.deepEqual(
    created.templates.map((template) => template.areaPlatform),
    [...CHECKLIST_AREAS],
  );
  assert.equal(created.templates.filter((template) => template.areaPlatform === "mobile iOS").length, 1);
  assert.equal(created.templates.filter((template) => template.areaPlatform === "mobile Android").length, 1);
});

test("version and audit history remain visible after edit and retire", () => {
  const store = createTemplateStore();
  const created = createTemplate(store, {
    actor: admin,
    project,
    ...entry("security"),
    changedAt: "2026-10-06T00:00:00Z",
  });
  assert.equal(created.ok, true);
  const lineageId = created.template.lineageId;

  const updated = updateTemplate(store, {
    actor: admin,
    lineageId,
    version: "2",
    requirement: "security requirement revised",
    changedAt: "2026-10-06T01:00:00Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.template.version, "2");
  assert.notEqual(updated.template.id, created.template.id);

  const retired = retireTemplate(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(retired.ok, true);

  const otherRead = readTemplateHistory(store, { actor: otherAdmin, lineageId });
  assert.equal(otherRead.error, "role scope denied");

  const history = readTemplateHistory(store, { actor: admin, lineageId });
  assert.equal(history.ok, true);
  assert.deepEqual(
    history.versions.map((template) => template.version),
    ["1", "2"],
  );
  assert.equal(history.versions.every((template) => template.retiredAt != null), true);
  assert.equal(history.audits.length, 3);
  assert.match(history.audits[0].afterValue, /"version":"1"/);
  assert.match(history.audits[1].beforeValue, /"version":"1"/);
  assert.match(history.audits[1].afterValue, /"version":"2"/);
  assert.equal(history.audits[2].changedAt, "2026-10-06T02:00:00Z");
});

test("an edit cannot move a template onto the other mobile list", () => {
  const store = createTemplateStore();
  const created = createTemplate(store, {
    actor: otherAdmin,
    project: otherProject,
    ...entry("mobile iOS"),
    changedAt: "2026-10-06T00:00:00Z",
  });
  const moved = updateTemplate(store, {
    actor: otherAdmin,
    lineageId: created.template.lineageId,
    areaPlatform: "mobile Android",
    version: "2",
    changedAt: "2026-10-06T01:00:00Z",
  });
  assert.equal(moved.error, "area cannot change");
  const history = readTemplateHistory(store, {
    actor: otherAdmin,
    lineageId: created.template.lineageId,
  });
  assert.deepEqual(history.versions.map((template) => template.areaPlatform), ["mobile iOS"]);
});
