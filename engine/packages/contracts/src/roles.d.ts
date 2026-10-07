export const ROLE_NAMES: readonly [
  "Super Admin",
  "Admin",
  "Super Distributor",
  "Distributor",
  "Retailer",
  "Customer",
];

export type RoleName = (typeof ROLE_NAMES)[number];

/** Hierarchy leaf. The catalog grant list for this role is empty. */
export const DEFAULT_ROLE: "Customer";

export const PERMISSION_MATRIX: { readonly [Role in RoleName]: readonly [] };

export function isKnownRole(name: string): name is RoleName;

export function catalogGrants(role: string): readonly [] | null;

export function roleDefinitions(): readonly { name: RoleName; isDefault: boolean }[];
