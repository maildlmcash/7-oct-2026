export const CAPABILITY_NAMES: readonly [
  "checklist.read",
  "checklist.write",
  "global.policy",
  "tenant.admin",
  "subtree.delegate",
  "commission.manage",
  "other-user.read",
  "connector.secret",
];

export const IDENTITY_STATUSES: readonly ["active", "suspended", "closed"];

export const ROLE_CAPABILITY_CEILING: {
  readonly "Super Admin": readonly [];
  readonly Admin: readonly [];
  readonly "Super Distributor": readonly [];
  readonly Distributor: readonly [];
  readonly Retailer: readonly [];
  readonly Customer: readonly [];
};

export function isKnownCapability(name: string): boolean;

export function isKnownStatus(status: string): boolean;

export function combinedRoleSet(roles: readonly string[]):
  | { ok: true; roles: string[] }
  | { ok: false; error: string };

export function mergeHeldCapabilities(
  roles: readonly string[],
  input?: {
    allows?: readonly string[];
    denies?: readonly string[];
    ceiling?: Readonly<Record<string, readonly string[]>>;
  },
): { ok: true; capabilities: string[] } | { ok: false; error: string; capabilities: readonly [] };

export function effectiveCapabilities(
  roles: readonly string[],
  rules?: readonly { capability: string; effect: "allow" | "deny" }[],
): { ok: true; capabilities: string[] } | { ok: false; error: string; capabilities: readonly [] };

export function shippedCeilingsAreEmpty(): boolean;

export function tenantParentLink(input: { tenantId: string | number | null; parentId: string | number | null }):
  | { ok: true }
  | { ok: false; error: string };

export function assignmentParentLink(input: {
  tenantId: string | number | null;
  parentTenantId: string | number | null;
}): { ok: true } | { ok: false; error: string };

export function isInSubtree(
  actorId: string | number | null,
  targetId: string | number | null,
  parentOf: (id: string) => string | number | null | undefined,
): boolean;
