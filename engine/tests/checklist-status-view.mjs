import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createChecklistStatusStore,
  editChecklistOwner,
  emptyChecklistStatusView,
  publishChecklistStatus,
  renderChecklistStatusView,
} from "../services/checklist-status-view.mjs";

const admin = { id: "admin-1", role: "Admin", tenantId: 1 };
const customer = { id: "customer-1", role: "Customer", tenantId: 1 };
const otherAdmin = { id: "admin-2", role: "Admin", tenantId: 2 };

function fixture() {
  return [
    {
      id: "pass-item",
      tenantId: 1,
      status: "PASS",
      owner: "owner-pass",
      evidenceLinks: ["file://pass"],
      prerequisites: [{ id: "done-pre", status: "PASS", owner: "hidden", evidenceLinks: ["file://hidden"] }],
    },
    {
      id: "fail-item",
      tenantId: 1,
      status: "FAIL",
      owner: "owner-fail",
      evidenceLinks: ["file://fail"],
      prerequisites: [
        { id: "blocked-pre", status: "BLOCKED", owner: "owner-blocked", evidenceLinks: ["file://blocked"] },
      ],
    },
    {
      id: "blocked-item",
      tenantId: 1,
      status: "BLOCKED",
      owner: "owner-block",
      evidenceLinks: ["file://block"],
      prerequisites: [],
    },
    {
      id: "stale-item",
      tenantId: 1,
      status: "STALE",
      owner: "owner-stale",
      evidenceLinks: ["file://stale"],
      prerequisites: [],
    },
    {
      id: "technology-item",
      tenantId: 1,
      status: "UNKNOWN/STALE",
      owner: "owner-technology",
      evidenceLinks: ["file://technology"],
      prerequisites: [],
    },
    {
      id: "open-item",
      tenantId: 1,
      status: "NOT_STARTED",
      owner: "",
      evidenceLinks: [],
      prerequisites: [{ id: "na-pre", status: "NOT_APPLICABLE", owner: "skipped", evidenceLinks: [] }],
    },
    {
      id: "other-tenant",
      tenantId: 2,
      status: "FAIL",
      owner: "other",
      evidenceLinks: ["file://other-tenant"],
      prerequisites: [],
    },
  ];
}

test("permission checks keep user-facing read separate from Admin editing", () => {
  const store = createChecklistStatusStore(fixture());
  const roles = ["Super Admin", "Super Distributor", "Distributor", "Retailer"];
  for (const role of roles) {
    const actor = { id: role, role, tenantId: 1 };
    assert.equal(publishChecklistStatus(store, { actor, tenantId: 1 }).error, "role scope denied");
    assert.equal(
      editChecklistOwner(store, { actor, tenantId: 1, recordId: "fail-item", owner: "changed" }).error,
      "role scope denied",
    );
  }
  assert.equal(
    editChecklistOwner(store, { actor: customer, tenantId: 1, recordId: "fail-item", owner: "changed" }).error,
    "role scope denied",
  );
  assert.equal(
    editChecklistOwner(store, { actor: otherAdmin, tenantId: 1, recordId: "fail-item", owner: "changed" }).error,
    "role scope denied",
  );

  const read = publishChecklistStatus(store, { actor: customer, tenantId: 1 });
  assert.equal(read.ok, true);
  assert.equal(read.view.canEdit, false);
  assert.equal(renderChecklistStatusView(read.view).includes("Edit checklist"), false);
  assert.equal(store.records.find((record) => record.id === "fail-item").owner, "owner-fail");

  const edited = editChecklistOwner(store, {
    actor: admin,
    tenantId: 1,
    recordId: "fail-item",
    owner: "owner-updated",
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.status, "FAIL");
  const adminView = publishChecklistStatus(store, { actor: admin, tenantId: 1 });
  assert.equal(adminView.view.canEdit, true);
  assert.equal(adminView.view.owners.find((item) => item.recordId === "fail-item").owner, "owner-updated");
  assert.equal(renderChecklistStatusView(adminView.view).includes("Edit checklist"), true);
});

test("status totals match fixture records", () => {
  const store = createChecklistStatusStore(fixture());
  const published = publishChecklistStatus(store, { actor: admin, tenantId: 1 });
  assert.deepEqual(published.view.counts, { PASS: 1, FAIL: 1, BLOCKED: 1, STALE: 1 });
  assert.deepEqual(
    published.view.unresolvedPrerequisites.map((item) => item.prerequisiteId),
    ["blocked-pre"],
  );
  assert.equal(published.view.unresolvedPrerequisites[0].owner, "owner-blocked");
  assert.deepEqual(published.view.unresolvedPrerequisites[0].evidenceLinks, ["file://blocked"]);
  assert.equal(published.view.owners.find((item) => item.recordId === "open-item").owner, "UNKNOWN");
  assert.equal(published.view.evidenceLinks.some((item) => item.url === "file://other-tenant"), false);
  assert.equal(published.view.evidenceLinks.some((item) => item.url === "file://hidden"), false);
  assert.equal(published.view.evidenceLinks.some((item) => item.url === "file://blocked"), true);
  const markup = renderChecklistStatusView(published.view);
  assert.match(markup, /PASS 1/);
  assert.match(markup, /FAIL 1/);
  assert.match(markup, /BLOCKED 1/);
  assert.match(markup, /STALE 1/);
  assert.match(markup, /file:\/\/fail/);
});

test("empty, loading, and error states render without ready records", () => {
  const store = createChecklistStatusStore(fixture());
  const empty = publishChecklistStatus(createChecklistStatusStore(), { actor: customer, tenantId: 1 });
  assert.equal(empty.view.state, "empty");
  const emptyMarkup = renderChecklistStatusView(empty.view);
  assert.match(emptyMarkup, /checklist status empty/);
  assert.match(emptyMarkup, /PASS 0/);
  assert.match(emptyMarkup, /unresolved prerequisites none/);
  assert.match(emptyMarkup, /owners none/);
  assert.match(emptyMarkup, /evidence links none/);
  assert.equal(emptyMarkup.includes("Edit checklist"), false);
  assert.equal(renderChecklistStatusView(emptyChecklistStatusView()).includes("checklist status empty"), true);

  const loading = publishChecklistStatus(store, { actor: customer, tenantId: 1, state: "loading" });
  const loadingMarkup = renderChecklistStatusView(loading.view);
  assert.match(loadingMarkup, /data-checklist-status-view="loading"/);
  assert.match(loadingMarkup, /checklist status loading/);
  assert.equal(loadingMarkup.includes("file://fail"), false);
  assert.equal(loadingMarkup.includes("PASS"), false);

  const error = publishChecklistStatus(store, {
    actor: admin,
    tenantId: 1,
    state: "error",
    error: "status <unavailable>",
  });
  const errorMarkup = renderChecklistStatusView(error.view);
  assert.match(errorMarkup, /data-checklist-status-view="error"/);
  assert.match(errorMarkup, /checklist status error/);
  assert.match(errorMarkup, /status &lt;unavailable&gt;/);
  assert.equal(errorMarkup.includes("file://fail"), false);
  assert.equal(errorMarkup.includes("Edit checklist"), false);
});
