// Agreed role names only. Phase 17 owns grants, delegation, and the approval matrix.
export const ROLE_NAMES = Object.freeze([
  "Super Admin",
  "Admin",
  "Super Distributor",
  "Distributor",
  "Retailer",
  "Customer",
]);

// Customer is the last role in the hierarchy. The catalog grants it nothing.
export const DEFAULT_ROLE = "Customer";

const NO_GRANTS = Object.freeze([]);

export const PERMISSION_MATRIX = Object.freeze({
  "Super Admin": NO_GRANTS,
  Admin: NO_GRANTS,
  "Super Distributor": NO_GRANTS,
  Distributor: NO_GRANTS,
  Retailer: NO_GRANTS,
  Customer: NO_GRANTS,
});

export function isKnownRole(name) {
  return ROLE_NAMES.includes(name);
}

export function catalogGrants(role) {
  if (!Object.hasOwn(PERMISSION_MATRIX, role)) return null;
  return PERMISSION_MATRIX[role];
}

export function roleDefinitions() {
  return ROLE_NAMES.map((name) => ({
    name,
    isDefault: name === DEFAULT_ROLE,
  }));
}
