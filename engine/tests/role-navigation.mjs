import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import { shippedCeilingsAreEmpty } from "../packages/contracts/src/identity/index.mjs";
import { writeChecklistOwner } from "../services/shell-capabilities.mjs";
import { createChecklistStatusStore } from "../services/checklist-status-view.mjs";
import {
  COMBINED_PREVIEW,
  NAV_DENIAL,
  PREVIEW_BANNER,
  decideNavigationAction,
  navigationFromSession,
  renderRoleNavigation,
} from "../apps/web/app/navigation/matrix.mjs";
import { postNavigationAction } from "../apps/web/navigation-http.mjs";

const SECRET = "super-secret-value";
const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-b-3");

const OPEN = {
  "Super Admin": ["Dashboard", "Checklist", "Admin"],
  Admin: ["Dashboard", "Checklist", "Admin"],
  "Super Distributor": ["Dashboard"],
  Distributor: ["Dashboard"],
  Retailer: ["Dashboard", "Paper"],
  Customer: ["Dashboard", "Market", "Paper", "Checklist"],
};

function session(roles, extras = {}) {
  return { authenticated: true, status: "active", roles, ...extras };
}

function closedScreens(role) {
  return ["Dashboard", "Market", "Paper", "Checklist", "Admin"].filter((screen) => !OPEN[role].includes(screen));
}

test("six roles and the combined account render only their screens", async () => {
  assert.equal(shippedCeilingsAreEmpty(), true);
  for (const role of ROLE_NAMES) assert.deepEqual([...catalogGrants(role)], []);

  const snapshot = {};
  const ui = {};
  for (const role of ROLE_NAMES) {
    const model = navigationFromSession(session([role]));
    assert.equal(model.ok, true);
    assert.deepEqual(model.sessionRoles, [role]);
    assert.deepEqual(model.screens, OPEN[role]);
    assert.equal(model.impersonation, false);
    assert.equal(model.canPreview, role === "Super Admin");
    assert.equal(model.denial, NAV_DENIAL);
    const html = renderRoleNavigation(model);
    assert.match(html, new RegExp(`data-session-role="${role}"`));
    assert.equal(html.includes('data-impersonation="false"'), true);
    for (const screen of model.screens) {
      assert.match(html, new RegExp(`<button type="button" data-screen="${screen}">${screen}</button>`));
    }
    for (const screen of closedScreens(role)) {
      assert.equal(html.includes(`data-screen="${screen}"`), false);
    }
    assert.ok(model.disabled.length > 0);
    for (const row of model.disabled) {
      assert.match(html, new RegExp(`<button type="button" data-action="${row.id}" disabled>${row.label}</button>`));
      assert.match(html, new RegExp(`<p data-denial="${row.id}">${NAV_DENIAL}</p>`));
      assert.equal(html.includes(`<button type="button" data-action="${row.id}">`), false);
    }
    snapshot[role] = {
      screens: model.screens,
      disabled: model.disabled.map((row) => row.label),
      canPreview: model.canPreview,
      impersonation: false,
    };
    ui[role] = html;
  }

  const combined = navigationFromSession(session(["Customer", "Retailer"]));
  assert.equal(combined.ok, true);
  assert.deepEqual(combined.sessionRoles, ["Retailer", "Customer"]);
  assert.deepEqual(combined.screens, ["Dashboard", "Market", "Paper", "Checklist"]);
  assert.equal(combined.canPreview, false);
  assert.equal(combined.impersonation, false);
  const combinedHtml = renderRoleNavigation(combined);
  assert.match(combinedHtml, /data-session-role="Retailer and Customer"/);
  assert.match(combinedHtml, /data-action="provider.edit" disabled/);
  assert.match(combinedHtml, /data-action="commission.manage" disabled/);
  assert.equal(combinedHtml.includes('data-screen="Admin"'), false);
  snapshot[COMBINED_PREVIEW] = {
    screens: combined.screens,
    disabled: combined.disabled.map((row) => row.label),
    canPreview: false,
    impersonation: false,
  };
  ui[COMBINED_PREVIEW] = combinedHtml;

  const deniedScreen = navigationFromSession(session(["Retailer", "Customer"], { denies: ["Market", SECRET] }));
  assert.equal(deniedScreen.screens.includes("Market"), false);
  assert.ok(deniedScreen.disabled.some((row) => row.id === "screen.Market"));
  assert.equal(JSON.stringify(deniedScreen).includes(SECRET), false);
  const deniedHtml = renderRoleNavigation(deniedScreen);
  assert.match(deniedHtml, /data-action="screen.Market" disabled/);
  assert.match(deniedHtml, new RegExp(`data-denial="screen.Market">${NAV_DENIAL}`));

  const preview = navigationFromSession(session(["Super Admin"]), { previewRole: "Customer" });
  assert.deepEqual(preview.sessionRoles, ["Super Admin"]);
  assert.deepEqual(preview.previewOf, ["Customer"]);
  assert.deepEqual(preview.screens, OPEN.Customer);
  assert.equal(preview.impersonation, false);
  const previewHtml = renderRoleNavigation(preview);
  assert.match(previewHtml, /data-preview="true"/);
  assert.match(previewHtml, new RegExp(PREVIEW_BANNER));
  assert.match(previewHtml, /data-session-role="Super Admin"/);
  assert.match(previewHtml, /data-action="provider.edit" disabled/);
  assert.equal(previewHtml.includes("<button type=\"button\" data-action=\"impersonate\">"), false);
  assert.equal(previewHtml.includes('data-screen="Admin"'), false);

  const customerPreview = navigationFromSession(session(["Customer"]), { previewRole: "Super Admin" });
  assert.equal(customerPreview.canPreview, false);
  assert.equal(customerPreview.previewOf, null);
  assert.deepEqual(customerPreview.screens, OPEN.Customer);
  assert.equal(customerPreview.previews, null);

  assert.equal(navigationFromSession(session(["Admin", "Customer"])).error, "role revoked");
  assert.match(renderRoleNavigation(navigationFromSession(session(["Admin"], { status: "suspended" }))), /role revoked/);
  assert.equal(renderRoleNavigation(navigationFromSession(null)), "");

  const source = await readFile(new URL("../apps/web/app/navigation/matrix.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("request.role"), false);
  assert.equal(source.includes("request.previewRole"), false);
  assert.equal(source.includes("LIVE"), false);

  await mkdir(evidenceDir, { recursive: true });
  const report = {
    task: "1.B.3",
    date: "2026-10-07",
    truth: "MOCK",
    denial: NAV_DENIAL,
    roles: snapshot,
  };
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  await writeFile(resolve(evidenceDir, "role-to-screen.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(evidenceDir, "role-to-screen.md"), [
    "# 1.B.3 role-to-screen snapshot",
    "",
    "Truth label: MOCK. Disabled actions use the denial sentence role scope denied.",
    "",
    ...Object.entries(snapshot).map(([role, row]) => [
      `## ${role}`,
      "",
      `Open: ${row.screens.join(", ")}`,
      "",
      `Disabled: ${row.disabled.join("; ")}`,
      "",
    ].join("\n")),
  ].join("\n"));
  await writeFile(resolve(evidenceDir, "ui-render.html"), Object.entries(ui).map(([role, html]) => `<section data-role="${role}">${html}</section>`).join("\n"));
});

test("the action API denies direct unauthorized calls and ignores preview", async () => {
  const cases = [];
  for (const role of ROLE_NAMES) {
    const actor = session([role]);
    for (const screen of closedScreens(role)) {
      const forged = {
        action: "screen.open",
        screen,
        role: "Super Admin",
        previewRole: "Super Admin",
        password: SECRET,
        editChecklist: true,
      };
      const decision = decideNavigationAction(actor, forged);
      const clean = decideNavigationAction(actor, { action: "screen.open", screen });
      assert.deepEqual(decision, clean);
      assert.equal(decision.ok, false);
      assert.equal(decision.error, NAV_DENIAL);
      assert.equal(JSON.stringify(decision).includes(SECRET), false);
      cases.push({ role, action: "screen.open", screen, error: decision.error });
    }
    assert.equal(decideNavigationAction(actor, { action: "screen.open", screen: OPEN[role][0] }).ok, true);
    const impersonation = decideNavigationAction(actor, { action: "impersonate", screen: "Admin", previewRole: role });
    assert.equal(impersonation.ok, false);
    assert.equal(impersonation.error, NAV_DENIAL);
    cases.push({ role, action: "impersonate", screen: null, error: impersonation.error });
  }

  const combined = session(["Retailer", "Customer"]);
  const adminScreen = decideNavigationAction(combined, { action: "screen.open", screen: "Admin", role: "Super Admin" });
  assert.equal(adminScreen.error, NAV_DENIAL);
  const market = decideNavigationAction(combined, { action: "screen.open", screen: "Market" });
  assert.equal(market.ok, true);
  const removed = decideNavigationAction(session(["Retailer", "Customer"], { denies: ["Market"] }), {
    action: "screen.open",
    screen: "Market",
    previewRole: "Super Admin",
  });
  assert.equal(removed.error, NAV_DENIAL);

  const superAdmin = session(["Super Admin"]);
  assert.equal(decideNavigationAction(superAdmin, { action: "screen.open", screen: "Admin" }).ok, true);
  assert.equal(decideNavigationAction(superAdmin, {
    action: "screen.open",
    screen: "Market",
    previewRole: "Customer",
    password: SECRET,
  }).error, NAV_DENIAL);
  assert.equal(decideNavigationAction(session(["Customer"]), {
    action: "screen.open",
    screen: "Admin",
    previewRole: "Super Admin",
  }).error, NAV_DENIAL);
  assert.equal(decideNavigationAction(session(["Admin"], { status: "suspended" }), {
    action: "screen.open",
    screen: "Dashboard",
  }).error, "role revoked");
  assert.equal(decideNavigationAction(null, { action: "screen.open", screen: "Admin", role: "Super Admin" }).error, "login denied");

  const store = createChecklistStatusStore([
    { id: "item-1", tenantId: 1, status: "FAIL", owner: "owner-fail", evidenceLinks: [], prerequisites: [] },
  ]);
  for (const role of [...ROLE_NAMES.filter((role) => role !== "Admin"), "Retailer+Customer"]) {
    const written = writeChecklistOwner(store, {
      actor: { id: role, role, tenantId: 1 },
      tenantId: 1,
      recordId: "item-1",
      owner: "changed",
      editChecklist: true,
      canEdit: true,
      password: SECRET,
    });
    assert.equal(written.ok, false);
    assert.equal(written.error, NAV_DENIAL);
    cases.push({ role, action: "checklist.write", screen: null, error: written.error });
  }
  assert.equal(store.records[0].owner, "owner-fail");

  const anonymous = await postNavigationAction(new Request("http://internal/api/navigation/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      role: "Super Admin",
      previewRole: "Super Admin",
      action: "screen.open",
      screen: "Admin",
      password: SECRET,
    }),
  }), {});
  assert.equal(anonymous.status, 401);
  const anonymousBody = await anonymous.json();
  assert.deepEqual(anonymousBody, { ok: false, error: "login denied" });
  assert.equal(JSON.stringify(anonymousBody).includes(SECRET), false);

  const customerCall = await postNavigationAction(new Request("http://internal/api/navigation/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      role: "Super Admin",
      previewRole: "Super Admin",
      action: "screen.open",
      screen: "Admin",
      password: SECRET,
    }),
  }), { identitySession: session(["Customer"]) });
  assert.equal(customerCall.status, 403);
  assert.deepEqual(await customerCall.json(), { ok: false, error: NAV_DENIAL });

  const report = { task: "1.B.3", date: "2026-10-07", truth: "MOCK", cases };
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "api-denial.json"), `${JSON.stringify(report, null, 2)}\n`);
});
