// Combined Retailer and Customer profiles for TASK 17.A.02.
// services/role-delegation.mjs still keeps one assignment per subject.
// A second profile is recorded only for that pair, and only after the
// existing seat policy allows the new seat. Reads name the profile.
// Removing a profile that still owns a resource requires a successor
// who already holds that same profile in the same tenant. This module
// does not add a catalog role, a permission, or a commission rule.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";
import { delegateRole } from "./role-delegation.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const ASSIGN_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "role",
  "subjectId",
  "changedAt",
  "permission",
  "ownerId",
]);
const RESOURCE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "profile",
  "resourceId",
  "changedAt",
  "permission",
  "ownerId",
]);
const READ_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "profile",
  "resourceId",
  "permission",
  "ownerId",
]);
const REMOVE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "subjectId",
  "profile",
  "successorId",
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

// Same descendant seats as role-delegation.mjs. This is not a new grant matrix.
const DESCENDANTS = Object.freeze({
  "Super Admin": Object.freeze(["Admin"]),
  Admin: Object.freeze(["Distributor", "Retailer"]),
  "Super Distributor": Object.freeze([]),
  Distributor: Object.freeze(["Retailer", "Customer"]),
  Retailer: Object.freeze(["Customer"]),
  Customer: Object.freeze([]),
});

export const PROFILE_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "combined identity is two profiles and not a new role",
  "only Retailer and Customer may share one subject",
  "Super Distributor descendants are NOT IN SOURCE",
  "Retailer seat-creation grantor is NOT IN SOURCE",
  "commission basis and caps are NOT IN SOURCE",
  "white-label and API partner are not catalog roles",
  "shell authorization is unchanged",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    profileCount: fields.profileCount ?? 0,
    resourceCount: fields.resourceCount ?? 0,
    assignmentCount: fields.assignmentCount ?? 0,
    idempotentReplay: fields.idempotentReplay === true,
    ownerSubjectId: fields.ownerSubjectId ?? null,
    profile: fields.profile ?? null,
    resourceId: fields.resourceId ?? null,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: PROFILE_LIMITATIONS,
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

function validStore(store) {
  return Boolean(store)
    && store.tenants instanceof Map
    && Array.isArray(store.assignments)
    && Array.isArray(store.capabilities)
    && Array.isArray(store.profiles)
    && Array.isArray(store.resources);
}

function counts(store) {
  return {
    profileCount: store.profiles.length,
    resourceCount: store.resources.length,
    assignmentCount: store.assignments.length,
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

function seatPolicy(store, actor, tenantId, role) {
  if (!isKnownRole(role)) return "role scope denied";
  const allowed = DESCENDANTS[actor.role] ?? [];
  if (!allowed.includes(role)) return "role is not a descendant";
  const capability = capabilityProblem(store, actor);
  if (capability) return capability;
  return tenantInScope(store, actor, tenantId);
}

function heldProfile(store, subjectId, role, tenantId) {
  return store.profiles.find((row) => (
    row.subjectId === subjectId && row.role === role && row.tenantId === tenantId
  )) ?? null;
}

function combinedPair(left, right) {
  return (left === "Retailer" && right === "Customer")
    || (left === "Customer" && right === "Retailer");
}

function knownProfile(value) {
  const profile = named(value, "profile is not held");
  if (!profile.ok) return profile;
  if (!isKnownRole(profile.value)) return { ok: false, error: "role scope denied" };
  return profile;
}

export function createProfileStore() {
  return {
    tenants: new Map(),
    assignments: [],
    capabilities: [],
    profiles: [],
    resources: [],
  };
}

export function assignProfile(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, ASSIGN_KEYS)) return fail("unsupported field", counts(store));
  const delegated = delegateRole(store, input);
  if (delegated.error && delegated.error !== "role is already recorded") {
    return fail(delegated.error, counts(store));
  }
  const existing = store.profiles.find((row) => row.subjectId === input.subjectId && row.role === input.role);
  if (delegated.ok) {
    if (existing) {
      const replay = existing.tenantId === input.tenantId
        && existing.grantedBy === input.actor.id
        && existing.changedAt === input.changedAt;
      if (!replay) return fail("profile is already recorded", counts(store));
      return view({ ok: true, idempotentReplay: true, ...counts(store) });
    }
    store.profiles.push(Object.freeze({
      subjectId: input.subjectId,
      role: input.role,
      tenantId: input.tenantId,
      grantedBy: input.actor.id,
      changedAt: input.changedAt,
    }));
    return view({ ok: true, ...counts(store) });
  }
  const prior = store.assignments.find((row) => row.subjectId === input.subjectId);
  if (!prior || prior.role === input.role || prior.tenantId !== input.tenantId || !combinedPair(prior.role, input.role)) {
    if (prior && prior.role === input.role) return fail("profile is already recorded", counts(store));
    return fail("profile is not combined", counts(store));
  }
  if (existing) {
    if (
      existing.tenantId === input.tenantId
      && existing.grantedBy === input.actor.id
      && existing.changedAt === input.changedAt
    ) {
      return view({ ok: true, idempotentReplay: true, ...counts(store) });
    }
    return fail("profile is already recorded", counts(store));
  }
  const first = heldProfile(store, input.subjectId, prior.role, prior.tenantId);
  if (!first) return fail("profile is not held", counts(store));
  store.profiles.push(Object.freeze({
    subjectId: input.subjectId,
    role: input.role,
    tenantId: input.tenantId,
    grantedBy: input.actor.id,
    changedAt: input.changedAt,
  }));
  return view({ ok: true, ...counts(store) });
}

export function recordProfileResource(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, RESOURCE_KEYS)) return fail("unsupported field", counts(store));
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const profile = knownProfile(input.profile);
  if (!profile.ok) return fail(profile.error, counts(store));
  const resourceId = named(input.resourceId, "resource owner is outside scope");
  if (!resourceId.ok) return fail(resourceId.error, counts(store));
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error, counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  if (!heldProfile(store, actor.actor.id, profile.value, tenantId.value)) {
    return fail("profile is not held", counts(store));
  }
  const prior = store.resources.find((row) => row.resourceId === resourceId.value);
  if (prior) {
    if (
      prior.ownerSubjectId === actor.actor.id
      && prior.profile === profile.value
      && prior.tenantId === tenantId.value
      && prior.changedAt === changedAt.value
    ) {
      return view({
        ok: true,
        idempotentReplay: true,
        ownerSubjectId: actor.actor.id,
        profile: profile.value,
        resourceId: resourceId.value,
        ...counts(store),
      });
    }
    return fail("resource is already recorded", counts(store));
  }
  store.resources.push(Object.freeze({
    resourceId: resourceId.value,
    ownerSubjectId: actor.actor.id,
    profile: profile.value,
    tenantId: tenantId.value,
    changedAt: changedAt.value,
  }));
  return view({
    ok: true,
    ownerSubjectId: actor.actor.id,
    profile: profile.value,
    resourceId: resourceId.value,
    ...counts(store),
  });
}

export function readProfileResource(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, READ_KEYS)) return fail("unsupported field", counts(store));
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const profile = knownProfile(input.profile);
  if (!profile.ok) return fail(profile.error, counts(store));
  const resourceId = named(input.resourceId, "resource owner is outside scope");
  if (!resourceId.ok) return fail(resourceId.error, counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  if (!heldProfile(store, actor.actor.id, profile.value, tenantId.value)) {
    return fail("profile is not held", counts(store));
  }
  const row = store.resources.find((item) => item.resourceId === resourceId.value);
  if (!row || row.ownerSubjectId !== actor.actor.id || row.profile !== profile.value || row.tenantId !== tenantId.value) {
    return fail("resource owner is outside scope", counts(store));
  }
  return view({
    ok: true,
    ownerSubjectId: row.ownerSubjectId,
    profile: row.profile,
    resourceId: row.resourceId,
    ...counts(store),
  });
}

function successorProblem(store, subjectId, role, tenantId, successorId) {
  if (successorId === subjectId) return "resource owner is outside scope";
  const held = store.profiles.find((row) => row.subjectId === successorId && row.role === role);
  if (!held) return "profile is not held";
  if (held.tenantId !== tenantId) return "tenant is outside subtree";
  return null;
}

function retargetAssignment(store, subjectId, removedRole, changedAt) {
  const remaining = store.profiles.filter((row) => row.subjectId === subjectId);
  const index = store.assignments.findIndex((row) => row.subjectId === subjectId);
  if (index < 0) return;
  if (remaining.length === 0) {
    store.assignments.splice(index, 1);
    return;
  }
  const current = store.assignments[index];
  if (current.role !== removedRole) return;
  const keep = remaining[0];
  store.assignments.splice(index, 1, Object.freeze({
    subjectId: current.subjectId,
    role: keep.role,
    tenantId: current.tenantId,
    ownerId: current.ownerId,
    grantedBy: current.grantedBy,
    changedAt,
  }));
}

export function removeProfile(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, REMOVE_KEYS)) return fail("unsupported field", counts(store));
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
  const profile = knownProfile(input.profile);
  if (!profile.ok) return fail(profile.error, counts(store));
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error, counts(store));
  if (subjectId.value === actor.actor.id) return fail("role scope denied", counts(store));
  const policy = seatPolicy(store, actor.actor, tenantId.value, profile.value);
  if (policy) return fail(policy, counts(store));
  const held = heldProfile(store, subjectId.value, profile.value, tenantId.value);
  if (!held) return fail("profile is not held", counts(store));
  let successor = null;
  if (input.successorId !== undefined) {
    const namedSuccessor = named(input.successorId, "resource owner is outside scope");
    if (!namedSuccessor.ok) return fail(namedSuccessor.error, counts(store));
    successor = namedSuccessor.value;
  }
  const owned = store.resources.filter((row) => (
    row.ownerSubjectId === subjectId.value
    && row.profile === profile.value
    && row.tenantId === tenantId.value
  ));
  if (owned.length > 0 && successor === null) {
    return fail("ownership would be orphaned", counts(store));
  }
  if (successor !== null) {
    const problem = successorProblem(store, subjectId.value, profile.value, tenantId.value, successor);
    if (problem) return fail(problem, counts(store));
    for (let index = 0; index < store.resources.length; index += 1) {
      const row = store.resources[index];
      if (row.ownerSubjectId === subjectId.value && row.profile === profile.value && row.tenantId === tenantId.value) {
        store.resources[index] = Object.freeze({ ...row, ownerSubjectId: successor });
      }
    }
  }
  const index = store.profiles.findIndex((row) => (
    row.subjectId === subjectId.value && row.role === profile.value && row.tenantId === tenantId.value
  ));
  if (index >= 0) store.profiles.splice(index, 1);
  retargetAssignment(store, subjectId.value, profile.value, changedAt.value);
  return view({ ok: true, ...counts(store) });
}
