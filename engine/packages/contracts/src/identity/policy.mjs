// Capability names and the deny-by-default merge for task 1.B.1.
// A role ceiling is the only set a role may contribute. The shipped ceiling
// is empty, so an allow does not grant anything. An explicit deny still wins.
// Retailer and Customer are the only pair that may share one principal.
// This module stores no secret, order, or wallet value.

import { ROLE_NAMES, catalogGrants, isKnownRole } from "../roles.mjs";

export const CAPABILITY_NAMES = Object.freeze([
  "checklist.read",
  "checklist.write",
  "global.policy",
  "tenant.admin",
  "subtree.delegate",
  "commission.manage",
  "other-user.read",
  "connector.secret",
]);

export const IDENTITY_STATUSES = Object.freeze(["active", "suspended", "closed"]);

const EMPTY = Object.freeze([]);

export const ROLE_CAPABILITY_CEILING = Object.freeze({
  "Super Admin": EMPTY,
  Admin: EMPTY,
  "Super Distributor": EMPTY,
  Distributor: EMPTY,
  Retailer: EMPTY,
  Customer: EMPTY,
});

export function isKnownCapability(name) {
  return CAPABILITY_NAMES.includes(name);
}

export function isKnownStatus(status) {
  return IDENTITY_STATUSES.includes(status);
}

export function combinedRoleSet(roles) {
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > 2) {
    return { ok: false, error: "profile is not combined" };
  }
  const unique = [...new Set(roles)];
  if (unique.length !== roles.length) return { ok: false, error: "profile is not combined" };
  if (unique.some((role) => !isKnownRole(role))) return { ok: false, error: "role scope denied" };
  if (unique.length === 2) {
    const sorted = [...unique].sort();
    if (sorted[0] !== "Customer" || sorted[1] !== "Retailer") {
      return { ok: false, error: "profile is not combined" };
    }
  }
  return { ok: true, roles: unique };
}

// Union the held roles' ceilings, keep an allow only when that role's ceiling
// contains it, then remove every explicit deny.
export function mergeHeldCapabilities(roles, input = {}) {
  const combined = combinedRoleSet(roles);
  if (!combined.ok) return { ok: false, error: combined.error, capabilities: EMPTY };
  const ceiling = input.ceiling ?? ROLE_CAPABILITY_CEILING;
  const allows = Array.isArray(input.allows) ? input.allows : EMPTY;
  const denies = new Set(Array.isArray(input.denies) ? input.denies : EMPTY);
  const union = new Set();
  for (const role of combined.roles) {
    const permitted = new Set(ceiling[role] ?? EMPTY);
    for (const name of allows) {
      if (!isKnownCapability(name)) continue;
      if (!permitted.has(name)) continue;
      if (denies.has(name)) continue;
      union.add(name);
    }
  }
  return { ok: true, capabilities: [...union].sort() };
}

export function effectiveCapabilities(roles, rules = []) {
  const allows = [];
  const denies = [];
  for (const rule of rules) {
    if (!rule || !isKnownCapability(rule.capability)) continue;
    if (rule.effect === "allow") allows.push(rule.capability);
    if (rule.effect === "deny") denies.push(rule.capability);
  }
  return mergeHeldCapabilities(roles, { allows, denies });
}

export function shippedCeilingsAreEmpty() {
  return ROLE_NAMES.every((role) => {
    const ceiling = ROLE_CAPABILITY_CEILING[role];
    const grants = catalogGrants(role);
    return Array.isArray(ceiling) && ceiling.length === 0 && Array.isArray(grants) && grants.length === 0;
  });
}
