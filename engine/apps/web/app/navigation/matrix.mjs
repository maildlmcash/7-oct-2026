// Role navigation for task 1.B.3.
// The server session is the only scope. Client role and preview fields are not read.
// Disabled rows are the baseline must-not actions. They use one denial sentence.
// Catalog grant lists are not changed here.

import { combinedRoleSet } from "../../../../packages/contracts/src/identity/index.mjs";
import { ROLE_NAMES } from "../../../../packages/contracts/src/roles.mjs";

export const NAV_DENIAL = "role scope denied";
export const PREVIEW_BANNER = "Preview only. The signed-in role stays Super Admin.";
export const COMBINED_PREVIEW = "Retailer and Customer";

const SCREEN_ORDER = Object.freeze(["Dashboard", "Market", "Paper", "Checklist", "Admin"]);

const ROLE_SCREENS = Object.freeze({
  "Super Admin": Object.freeze(["Dashboard", "Checklist", "Admin"]),
  Admin: Object.freeze(["Dashboard", "Checklist", "Admin"]),
  "Super Distributor": Object.freeze(["Dashboard"]),
  Distributor: Object.freeze(["Dashboard"]),
  Retailer: Object.freeze(["Dashboard", "Paper"]),
  Customer: Object.freeze(["Dashboard", "Market", "Paper", "Checklist"]),
});

const ROLE_DISABLED = Object.freeze({
  "Super Admin": Object.freeze([
    Object.freeze({ id: "secrets.read", label: "Read exchange secrets" }),
    Object.freeze({ id: "impersonate", label: "Impersonate user" }),
    Object.freeze({ id: "audit.override", label: "Override audit trail" }),
  ]),
  Admin: Object.freeze([
    Object.freeze({ id: "cross-tenant", label: "Open another tenant" }),
    Object.freeze({ id: "role.escalate", label: "Assign a higher role" }),
  ]),
  "Super Distributor": Object.freeze([
    Object.freeze({ id: "global.policy", label: "Change global policy" }),
    Object.freeze({ id: "cross-tenant", label: "Open another tenant" }),
  ]),
  Distributor: Object.freeze([
    Object.freeze({ id: "role.escalate", label: "Create a Super Distributor" }),
    Object.freeze({ id: "commission.manage", label: "Change global rates" }),
  ]),
  Retailer: Object.freeze([
    Object.freeze({ id: "role.escalate", label: "Create a distributor role" }),
    Object.freeze({ id: "other-user.read", label: "View another retailer" }),
  ]),
  Customer: Object.freeze([
    Object.freeze({ id: "provider.edit", label: "Edit provider registry" }),
    Object.freeze({ id: "role.edit", label: "Edit roles" }),
    Object.freeze({ id: "commission.manage", label: "Edit commissions" }),
  ]),
});

function emptyView(error) {
  return {
    ok: false,
    error,
    authenticated: error !== "login denied",
    sessionRoles: [],
    canPreview: false,
    impersonation: false,
    previewOf: null,
    screens: [],
    disabled: [],
    denial: error,
    previews: null,
  };
}

function orderedRoles(roles) {
  return ROLE_NAMES.filter((role) => roles.includes(role));
}

function unionScreens(roles) {
  const open = new Set();
  for (const role of roles) {
    for (const screen of ROLE_SCREENS[role] ?? []) open.add(screen);
  }
  return SCREEN_ORDER.filter((screen) => open.has(screen));
}

function unionDisabled(roles) {
  const seen = new Set();
  const rows = [];
  for (const role of roles) {
    for (const row of ROLE_DISABLED[role] ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push({ id: row.id, label: row.label });
    }
  }
  return rows;
}

function viewForRoles(roles, screenDenies) {
  const held = orderedRoles(roles);
  const deniedScreens = SCREEN_ORDER.filter((screen) => screenDenies.includes(screen));
  const screens = unionScreens(held).filter((screen) => !deniedScreens.includes(screen));
  const disabled = unionDisabled(held);
  for (const screen of deniedScreens) {
    if (unionScreens(held).includes(screen)) {
      disabled.push({ id: `screen.${screen}`, label: `Open ${screen}` });
    }
  }
  return { sessionRoles: held, screens, disabled };
}

function previewSessions() {
  const previews = {};
  for (const role of ROLE_NAMES) {
    previews[role] = viewForRoles([role], []);
  }
  previews[COMBINED_PREVIEW] = viewForRoles(["Retailer", "Customer"], []);
  return previews;
}

function rolesForPreview(previewRole) {
  if (previewRole === COMBINED_PREVIEW) return ["Retailer", "Customer"];
  if (ROLE_NAMES.includes(previewRole)) return [previewRole];
  return null;
}

export function navigationFromSession(session, options = {}) {
  if (!session || session.authenticated !== true) return emptyView("login denied");
  if (session.status != null && session.status !== "active") return emptyView("role revoked");
  const combined = combinedRoleSet(Array.isArray(session.roles) ? session.roles : []);
  if (!combined.ok) return emptyView("role revoked");
  const denies = Array.isArray(session.denies) ? session.denies.filter((item) => SCREEN_ORDER.includes(item)) : [];
  const base = viewForRoles(combined.roles, denies);
  const canPreview = base.sessionRoles.length === 1 && base.sessionRoles[0] === "Super Admin";
  const previewRoles = canPreview ? rolesForPreview(options.previewRole) : null;
  const shown = previewRoles ? viewForRoles(previewRoles, []) : base;
  return {
    ok: true,
    error: null,
    authenticated: true,
    sessionRoles: base.sessionRoles,
    canPreview,
    impersonation: false,
    previewOf: previewRoles,
    screens: shown.screens,
    disabled: shown.disabled,
    denial: NAV_DENIAL,
    previews: canPreview ? previewSessions() : null,
  };
}

export function decideNavigationAction(session, request) {
  const model = navigationFromSession(session);
  if (!model.ok) return { ok: false, error: model.error };
  const action = request?.action;
  const screen = request?.screen;
  if (action === "screen.open" && typeof screen === "string" && model.screens.includes(screen)) {
    return { ok: true };
  }
  return { ok: false, error: NAV_DENIAL };
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderRoleNavigation(model) {
  if (!model?.authenticated) return "";
  if (!model.ok) {
    return `<nav aria-label="Role access" data-preview="false" data-impersonation="false"><p data-denial="session">${escapeText(model.error)}</p></nav>`;
  }
  const preview = model.previewOf != null;
  const role = model.sessionRoles.join(" and ");
  const screens = model.screens.map((screen) => (
    `<button type="button" data-screen="${escapeText(screen)}">${escapeText(screen)}</button>`
  )).join("");
  const disabled = model.disabled.map((row) => (
    `<button type="button" data-action="${escapeText(row.id)}" disabled>${escapeText(row.label)}</button>`
    + `<p data-denial="${escapeText(row.id)}">${escapeText(model.denial)}</p>`
  )).join("");
  const banner = preview ? `<p data-preview-banner="true">${escapeText(PREVIEW_BANNER)}</p>` : "";
  return `<nav aria-label="Role access" data-preview="${preview ? "true" : "false"}" data-impersonation="false">`
    + `<p data-session-role="${escapeText(role)}">${escapeText(role)}</p>`
    + banner
    + screens
    + disabled
    + `</nav>`;
}
