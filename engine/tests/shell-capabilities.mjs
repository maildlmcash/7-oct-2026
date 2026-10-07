import assert from "node:assert/strict";
import { test } from "node:test";
import { createChecklistStatusStore } from "../services/checklist-status-view.mjs";
import {
  SHELL_ROLES,
  authorizeShell,
  renderSectionCapability,
  writeChecklistOwner,
} from "../services/shell-capabilities.mjs";

const tenantId = 1;

function actor(role, actorTenant = tenantId) {
  return { id: role, role, tenantId: actorTenant };
}

function rendered(role, actorTenant = tenantId) {
  const capabilities = authorizeShell(actor(role, actorTenant), tenantId);
  return ["Checklist", "Market", "Admin"]
    .map((section) => renderSectionCapability(capabilities, section, "<p>checklist status empty</p>"))
    .join("");
}

test("each role gets only its server-authorized controls", () => {
  for (const role of SHELL_ROLES) {
    const html = rendered(role);
    if (role === "Admin") {
      assert.match(html, /data-view="admin-controls"/);
      assert.match(html, /Edit checklist/);
      assert.equal(html.includes('data-view="user-checklist"'), false);
      assert.equal(html.includes('data-view="market"'), false);
    } else if (role === "Customer") {
      assert.match(html, /data-view="user-checklist"/);
      assert.match(html, /data-view="market"/);
      assert.equal(html.includes("Edit checklist"), false);
      assert.equal(html.indexOf('data-view="user-checklist"') !== html.indexOf('data-view="market"'), true);
    } else {
      assert.equal(html.includes("Edit checklist"), false);
      assert.equal(html.includes('data-view="user-checklist"'), false);
      assert.equal(html.includes('data-view="market"'), false);
    }
  }

  const crossTenant = rendered("Admin", 2);
  assert.equal(crossTenant.includes("Edit checklist"), false);
  const customerMarket = renderSectionCapability(authorizeShell(actor("Customer"), tenantId), "Market");
  assert.equal(customerMarket.includes("Edit checklist"), false);
  const adminMarket = renderSectionCapability(authorizeShell(actor("Admin"), tenantId), "Market");
  assert.equal(adminMarket.includes("Edit checklist"), false);
});

test("direct writes reject unauthorized actors even when the client claims edit", () => {
  const store = createChecklistStatusStore([
    { id: "item-1", tenantId, status: "FAIL", owner: "owner-fail", evidenceLinks: [], prerequisites: [] },
  ]);
  const deniedRoles = SHELL_ROLES.filter((role) => role !== "Admin");
  for (const role of deniedRoles) {
    const result = writeChecklistOwner(store, {
      actor: actor(role),
      tenantId,
      recordId: "item-1",
      owner: "changed",
      editChecklist: true,
      canEdit: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "role scope denied");
  }
  const crossTenant = writeChecklistOwner(store, {
    actor: actor("Admin", 2),
    tenantId,
    recordId: "item-1",
    owner: "changed",
    editChecklist: true,
  });
  assert.equal(crossTenant.error, "role scope denied");
  assert.equal(store.records[0].owner, "owner-fail");

  const written = writeChecklistOwner(store, {
    actor: actor("Admin"),
    tenantId,
    recordId: "item-1",
    owner: "owner-updated",
    editChecklist: false,
  });
  assert.equal(written.ok, true);
  assert.equal(store.records[0].owner, "owner-updated");
  assert.equal(store.records[0].status, "FAIL");
});
