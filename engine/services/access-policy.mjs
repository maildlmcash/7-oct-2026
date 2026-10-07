import { canEditChecklist } from "./checklist-status-view.mjs";
import { SHELL_ROLES } from "./shell-capabilities.mjs";

const ROLES = new Set(SHELL_ROLES);
const ACTIONS = new Set(["checklist.write", "checklist.read", "deny"]);
const RESULTS = new Set(["ok", "denied", "unauthenticated"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensure(store) {
  if (!store || typeof store !== "object") return false;
  if (!store.principals) store.principals = new Map();
  if (!store.resources) store.resources = new Map();
  return true;
}

function accountBySubject(store, subjectId) {
  if (!store?.accounts) return null;
  for (const account of store.accounts.values()) {
    if (account.subjectId === subjectId) return account;
  }
  return null;
}

function writeAccessLog(log, event) {
  if (!Array.isArray(log)) return;
  const action = ACTIONS.has(event?.action) ? event.action : "deny";
  const result = RESULTS.has(event?.result) ? event.result : "denied";
  const subjectId = typeof event?.subjectId === "string" && UUID_PATTERN.test(event.subjectId)
    ? event.subjectId
    : null;
  const correlationId = typeof event?.correlationId === "string" && UUID_PATTERN.test(event.correlationId)
    ? event.correlationId
    : null;
  log.push({ action, result, subjectId, correlationId });
}

function accountFor(store, input) {
  const subjectId = typeof input?.subjectId === "string" ? input.subjectId : null;
  const loginId = typeof input?.loginId === "string" ? input.loginId : null;
  if (subjectId) {
    const account = accountBySubject(store, subjectId);
    if (!account) return null;
    if (loginId && loginId !== account.loginId) return null;
    return account;
  }
  if (!loginId || !store.accounts) return null;
  return store.accounts.get(loginId) ?? null;
}

export function bindPrincipal(store, input) {
  if (!ensure(store) || !store.accounts) return { ok: false, error: "login denied" };
  if (typeof input?.role !== "string" || !ROLES.has(input.role)) {
    return { ok: false, error: "role scope denied" };
  }
  if (!Object.prototype.hasOwnProperty.call(input, "tenantId") || input.tenantId == null) {
    return { ok: false, error: "role scope denied" };
  }
  const account = accountFor(store, input);
  if (!account) return { ok: false, error: "login denied" };
  store.principals.set(account.subjectId, {
    subjectId: account.subjectId,
    role: input.role,
    tenantId: input.tenantId,
  });
  return { ok: true, subjectId: account.subjectId };
}

export function registerResource(store, input) {
  if (!ensure(store)) return { ok: false, error: "role scope denied" };
  if (typeof input?.recordId !== "string" || input.recordId.length === 0) {
    return { ok: false, error: "role scope denied" };
  }
  if (!Object.prototype.hasOwnProperty.call(input, "tenantId") || input.tenantId == null) {
    return { ok: false, error: "role scope denied" };
  }
  let ownerSubjectId = null;
  if (Object.prototype.hasOwnProperty.call(input, "ownerSubjectId") && input.ownerSubjectId != null) {
    if (typeof input.ownerSubjectId !== "string" || input.ownerSubjectId.length === 0) {
      return { ok: false, error: "role scope denied" };
    }
    ownerSubjectId = input.ownerSubjectId;
  }
  store.resources.set(input.recordId, {
    recordId: input.recordId,
    tenantId: input.tenantId,
    ownerSubjectId,
  });
  return { ok: true };
}

function allowed(store, subjectId, action, recordId) {
  const principal = store?.principals?.get(subjectId);
  if (!principal) return false;
  if (typeof recordId !== "string" || recordId.length === 0) return false;
  const resource = store.resources?.get(recordId);
  if (!resource) return false;
  if (action === "checklist.write") {
    return canEditChecklist(
      { role: principal.role, tenantId: principal.tenantId },
      resource.tenantId,
    );
  }
  if (action === "checklist.read") {
    return principal.role === "Customer"
      && principal.tenantId === resource.tenantId
      && typeof resource.ownerSubjectId === "string"
      && resource.ownerSubjectId === principal.subjectId;
  }
  return false;
}

export function authorizeRequest(store, input) {
  const action = input?.action;
  const correlationId = input?.correlationId;
  const authenticated = input?.authenticated === true
    && typeof input?.subjectId === "string"
    && input.subjectId.length > 0;
  if (!authenticated) {
    writeAccessLog(input?.log, { action, result: "unauthenticated", correlationId });
    return { ok: false, error: "login denied" };
  }
  const granted = allowed(store, input.subjectId, action, input?.recordId);
  writeAccessLog(input?.log, {
    action,
    result: granted ? "ok" : "denied",
    subjectId: input.subjectId,
    correlationId,
  });
  return granted ? { ok: true } : { ok: false, error: "role scope denied" };
}
