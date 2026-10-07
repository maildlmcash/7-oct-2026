// Descendant-only delegation for TASK 17.A.01.
// Design section 12 names the seats each role may create. The catalog in
// packages/contracts/src/roles.mjs stays empty, so a permission cannot be
// delegated. Super Distributor has no descendant in that section. Retailer's
// seat-creation grantor is not named. This module does not open a database
// and does not read environment variables.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const TENANT_KEYS = Object.freeze(["actor", "tenantId", "parentId"]);
const GRANT_KEYS = Object.freeze(["actor", "tenantId", "subjectId", "changedAt", "permission", "ownerId"]);
const DELEGATE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "role",
  "subjectId",
  "changedAt",
  "permission",
  "ownerId",
]);
const CREDENTIAL_KEYS = new Set([
  "apiKey",
  "apiSecret",
  "secret",
  "privateKey",
  "seedPhrase",
  "token",
  "password",
  "credential",
]);

// Seats named by design section 12. An empty list delegates nothing.
const DESCENDANTS = Object.freeze({
  "Super Admin": Object.freeze(["Admin"]),
  Admin: Object.freeze(["Distributor", "Retailer"]),
  "Super Distributor": Object.freeze([]),
  Distributor: Object.freeze(["Retailer", "Customer"]),
  Retailer: Object.freeze(["Customer"]),
  Customer: Object.freeze([]),
});

export const DELEGATION_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "a permission cannot be delegated",
  "Super Distributor descendants are NOT IN SOURCE",
  "Retailer seat-creation grantor is NOT IN SOURCE",
  "commission ceilings are NOT IN SOURCE",
  "white-label and API partner are not catalog roles",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    assignmentCount: fields.assignmentCount ?? 0,
    capabilityCount: fields.capabilityCount ?? 0,
    idempotentReplay: fields.idempotentReplay === true,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: DELEGATION_LIMITATIONS,
  });
}

function fail(error, extra = {}) {
  return view({ ok: false, error, ...extra });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function leaked(value) {
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function problemIn(value, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    return leaked(value) ? "secret value is not allowed" : null;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = problemIn(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (leaked(key) || CREDENTIAL_KEYS.has(key)) {
      return leaked(key) || leaked(value[key]) ? "secret value is not allowed" : "live credentials are not allowed";
    }
    const found = problemIn(value[key], seen);
    if (found) return found;
  }
  return null;
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function actorOf(actor) {
  if (!plainObject(actor) || unknownKey(actor, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  const id = named(actor.id, "role scope denied");
  if (!id.ok) return id;
  const tenantId = named(actor.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (!isKnownRole(actor.role)) return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function counts(store) {
  return {
    assignmentCount: store.assignments.length,
    capabilityCount: store.capabilities.length,
  };
}

function permissionProblem(actor, permission) {
  if (permission === undefined) return null;
  if (typeof permission !== "string") return "unsupported field";
  const grants = catalogGrants(actor.role);
  if (!grants || !grants.includes(permission)) return "permission is not granted";
  return null;
}

function ownerProblem(actor, ownerId) {
  if (ownerId === undefined) return null;
  const owner = named(ownerId, "resource owner is outside scope");
  if (!owner.ok) return owner.error === "unsupported field" ? "unsupported field" : "resource owner is outside scope";
  if (owner.value !== actor.id) return "resource owner is outside scope";
  return null;
}

function tenantInScope(store, actor, tenantId) {
  if (!store.tenants.has(tenantId)) return "tenant is not configured";
  if (actor.role === "Super Admin") return null;
  if (!store.tenants.has(actor.tenantId)) return "tenant is not configured";
  let current = tenantId;
  const seen = new Set();
  while (current) {
    if (seen.has(current)) return "tenant is outside subtree";
    seen.add(current);
    if (current === actor.tenantId) return null;
    const row = store.tenants.get(current);
    current = row ? row.parentId : null;
  }
  return "tenant is outside subtree";
}

function capabilityProblem(store, actor) {
  if (actor.role === "Distributor") {
    const granted = store.capabilities.some((row) => (
      row.subjectId === actor.id
      && row.tenantId === actor.tenantId
      && row.grantorRole === "Admin"
    ));
    if (!granted) return "capability is not granted";
    return null;
  }
  if (actor.role === "Retailer") return "capability grantor is not configured";
  return null;
}

export function createDelegationStore() {
  return { tenants: new Map(), assignments: [], capabilities: [] };
}

export function registerDelegationTenant(store, input) {
  if (!store || !(store.tenants instanceof Map) || !Array.isArray(store.assignments)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(secret);
  if (unknownKey(input, TENANT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  if (actor.actor.role !== "Super Admin") return fail("role scope denied", counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  if (store.tenants.has(tenantId.value)) return fail("tenant is already recorded", counts(store));
  let parentId = null;
  if (input.parentId !== null) {
    const parent = named(input.parentId, "tenant is not configured");
    if (!parent.ok) return fail(parent.error, counts(store));
    if (!store.tenants.has(parent.value)) return fail("tenant is not configured", counts(store));
    parentId = parent.value;
  }
  store.tenants.set(tenantId.value, Object.freeze({ tenantId: tenantId.value, parentId }));
  return view({ ok: true, ...counts(store) });
}

export function grantSeatCapability(store, input) {
  if (!store || !(store.tenants instanceof Map) || !Array.isArray(store.capabilities)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(secret);
  if (unknownKey(input, GRANT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const subjectId = named(input.subjectId, "role scope denied");
  if (!subjectId.ok) return fail(subjectId.error, counts(store));
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error, counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  const assignment = store.assignments.find((row) => row.subjectId === subjectId.value && row.tenantId === tenantId.value);
  if (assignment && assignment.role === "Retailer") return fail("capability grantor is not configured", counts(store));
  if (!assignment || assignment.role !== "Distributor") return fail("delegation is not configured", counts(store));
  if (actor.actor.role !== "Admin") return fail("capability grantor is not configured", counts(store));
  const prior = store.capabilities.find((row) => row.subjectId === subjectId.value && row.tenantId === tenantId.value);
  if (prior) {
    if (prior.grantedBy === actor.actor.id && prior.changedAt === changedAt.value) {
      return view({ ok: true, idempotentReplay: true, ...counts(store) });
    }
    return fail("capability is already recorded", counts(store));
  }
  store.capabilities.push(Object.freeze({
    subjectId: subjectId.value,
    tenantId: tenantId.value,
    grantorRole: "Admin",
    grantedBy: actor.actor.id,
    changedAt: changedAt.value,
  }));
  return view({ ok: true, ...counts(store) });
}

export function delegateRole(store, input) {
  if (!store || !(store.tenants instanceof Map) || !Array.isArray(store.assignments)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(secret);
  if (unknownKey(input, DELEGATE_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const subjectId = named(input.subjectId, "role scope denied");
  if (!subjectId.ok) return fail(subjectId.error, counts(store));
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error, counts(store));
  if (!isKnownRole(input.role)) return fail("role scope denied", counts(store));
  if (subjectId.value === actor.actor.id) return fail("role scope denied", counts(store));
  const allowed = DESCENDANTS[actor.actor.role] ?? [];
  if (!allowed.includes(input.role)) return fail("role is not a descendant", counts(store));
  const capability = capabilityProblem(store, actor.actor);
  if (capability) return fail(capability, counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  const prior = store.assignments.find((row) => row.subjectId === subjectId.value);
  if (prior) {
    if (
      prior.role === input.role
      && prior.tenantId === tenantId.value
      && prior.grantedBy === actor.actor.id
      && prior.changedAt === changedAt.value
    ) {
      return view({ ok: true, idempotentReplay: true, ...counts(store) });
    }
    return fail("role is already recorded", counts(store));
  }
  store.assignments.push(Object.freeze({
    subjectId: subjectId.value,
    role: input.role,
    tenantId: tenantId.value,
    ownerId: actor.actor.id,
    grantedBy: actor.actor.id,
    changedAt: changedAt.value,
  }));
  return view({ ok: true, ...counts(store) });
}
