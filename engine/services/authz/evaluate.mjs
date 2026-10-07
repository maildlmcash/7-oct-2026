// Policy evaluator for protected control operations.
// It does not read the UI, an HTTP body, or a session cookie.
// Client role, capability, and secret fields on the request are never copied.
// Privileged decisions append an allowlisted audit row. The shipped role
// ceiling is empty unless the caller passes a fixture ceiling.

import {
  combinedRoleSet,
  isInSubtree,
  mergeHeldCapabilities,
} from "../../packages/contracts/src/identity/index.mjs";
import { matchControlRoute } from "./routes.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IGNORED_CLIENT_FIELDS = Object.freeze([
  "role",
  "tenantId",
  "editChecklist",
  "canEdit",
  "capability",
  "password",
  "token",
  "cookie",
  "proof",
  "apiKey",
  "seed",
  "authorization",
]);

function lookup(table, id) {
  if (table == null || id == null) return null;
  if (typeof table.get === "function") return table.get(id) ?? table.get(String(id)) ?? null;
  return table[id] ?? table[String(id)] ?? null;
}

function safeId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function activeAssignments(principal) {
  const rows = Array.isArray(principal?.assignments) ? principal.assignments : [];
  return rows.filter((row) => row && row.status === "active" && typeof row.role === "string");
}

function parentIdOf(principal) {
  const parents = new Set();
  for (const row of activeAssignments(principal)) {
    if (row.parentPrincipalId != null) parents.add(String(row.parentPrincipalId));
  }
  if (parents.size > 1) return { ok: false, parent: null };
  if (parents.size === 1) return { ok: true, parent: [...parents][0] };
  return { ok: true, parent: null };
}

function tenantParentOf(directory) {
  return (id) => {
    const tenant = lookup(directory?.tenants, id);
    if (!tenant || tenant.parentId == null) return null;
    return tenant.parentId;
  };
}

function auditTarget(request) {
  const tenant = safeId(request?.targetTenantId);
  const principal = safeId(request?.targetPrincipalId);
  if (tenant && principal) return `tenant:${tenant}/principal:${principal}`;
  if (tenant) return `tenant:${tenant}`;
  if (principal) return `principal:${principal}`;
  return "redacted";
}

function finish(directory, route, request, decision, reason) {
  let recordedDecision = decision;
  let recordedReason = reason;
  const privileged = route?.privileged === true;
  const canAudit = Array.isArray(directory?.audit);
  if (privileged && recordedDecision === "granted" && !canAudit) {
    recordedDecision = "denied";
    recordedReason = "capability denied";
  }
  let audited = false;
  if (privileged && canAudit) {
    directory.audit.push(Object.freeze({
      actor: safeId(request?.principalId),
      action: route.capability,
      target: auditTarget(request),
      decision: recordedDecision,
      reason: recordedReason,
    }));
    audited = true;
  }
  return Object.freeze({
    ok: recordedDecision === "granted",
    decision: recordedDecision,
    reason: recordedReason,
    action: route?.capability ?? null,
    route: route ? `${route.method} ${route.path}` : null,
    audited,
  });
}

function scopeReason(directory, actor, request) {
  const actorTenantId = actor.tenantId;
  const targetTenantId = request.targetTenantId;
  if (safeId(actorTenantId) == null || safeId(targetTenantId) == null) return "cross-tenant";
  const parents = tenantParentOf(directory);
  const targetInActor = isInSubtree(actorTenantId, targetTenantId, parents);
  if (!targetInActor) {
    const actorInTarget = String(actorTenantId) !== String(targetTenantId)
      && isInSubtree(targetTenantId, actorTenantId, parents);
    return actorInTarget ? "privilege escalation" : "cross-tenant";
  }
  const targetTenant = lookup(directory?.tenants, targetTenantId);
  if (!targetTenant || targetTenant.status !== "active") return "role revoked";

  if (request.targetPrincipalId == null) return null;
  if (safeId(request.targetPrincipalId) == null) return "privilege escalation";
  if (String(request.targetPrincipalId).toLowerCase() === String(actor.id).toLowerCase()) return null;

  const target = lookup(directory?.principals, request.targetPrincipalId);
  if (!target || String(target.tenantId).toLowerCase() !== String(targetTenantId).toLowerCase()) {
    return "privilege escalation";
  }
  let conflict = false;
  const parentOf = (id) => {
    const principal = lookup(directory?.principals, id);
    if (!principal) return null;
    const resolved = parentIdOf(principal);
    if (!resolved.ok) {
      conflict = true;
      return null;
    }
    return resolved.parent;
  };
  const inside = isInSubtree(actor.id, request.targetPrincipalId, parentOf);
  if (conflict || !inside) return "privilege escalation";
  return null;
}

function heldCapabilities(roles, rules, ceiling) {
  const allows = [];
  const denies = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule) continue;
    if (rule.effect === "allow") allows.push(rule.capability);
    if (rule.effect === "deny") denies.push(rule.capability);
  }
  return mergeHeldCapabilities(roles, {
    allows,
    denies,
    ...(ceiling ? { ceiling } : {}),
  });
}

export function authorizeControlRequest(directory, request, options = {}) {
  const route = matchControlRoute(request?.method, request?.path);
  const deny = (reason) => finish(directory, route, request, "denied", reason);
  if (!route) return deny("capability denied");
  if (safeId(request?.principalId) == null) return deny("login denied");

  const actor = lookup(directory?.principals, request.principalId);
  if (!actor || actor.status !== "active") return deny("role revoked");
  if (safeId(actor.id) == null || safeId(actor.id) !== safeId(request.principalId)) return deny("role revoked");

  const actorTenant = lookup(directory?.tenants, actor.tenantId);
  if (!actorTenant || actorTenant.status !== "active") return deny("role revoked");

  const roles = activeAssignments(actor).map((row) => row.role);
  if (!combinedRoleSet(roles).ok) return deny("role revoked");

  const scope = scopeReason(directory, actor, request);
  if (scope) return deny(scope);

  const rules = options.rules ?? actor.rules ?? directory?.rules ?? [];
  const held = heldCapabilities(roles, rules, options.ceiling);
  if (!held.ok || !held.capabilities.includes(route.capability)) return deny("capability denied");
  return finish(directory, route, request, "granted", "granted");
}
