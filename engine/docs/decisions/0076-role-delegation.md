# 0076 — Descendant-only delegation

Status: accepted for descendant seat delegation. Catalog permissions stay empty. A child cannot grant an upstream or sibling role, and no role can delegate a permission.

## Context

TASK 17.A.01 asks for the six roles with tenant, subtree, and resource-owner scope. A role may delegate only permissions and descendants that policy explicitly allows. A child must not grant an upstream or sibling role or exceed its own permission scope.

Design section 12 says Super Admin creates Admins, and Admin creates Distributor and Retailer seats inside assigned tenant scope. Distributor creates Retailer and Customer seats only when Admin grants that capability. Retailer manages customer accounts only if a capability is granted. Customer creates no subordinate role. The same section does not name a Super Distributor descendant or the grantor of a Retailer seat capability. Decision 0011 keeps every catalog grant list empty. `authorizeShell` is unchanged.

## Decision

`services/role-delegation.mjs` exports `createDelegationStore`, `registerDelegationTenant`, `grantSeatCapability`, `delegateRole`, and `DELEGATION_LIMITATIONS`.

The tenant table has no parent column, so the tenant tree stays in the delegation store. Only Super Admin registers a tenant. Admin, Super Distributor, Distributor, Retailer, and Customer do not.

Super Admin may delegate Admin into any registered tenant. Admin may delegate Distributor or Retailer only inside the Admin tenant or its descendants. Distributor may delegate Retailer or Customer only after an Admin records a seat capability for that Distributor, and only inside the Distributor subtree. Any other role target is `role is not a descendant`. A sibling tenant or a parent tenant is `tenant is outside subtree`.

Super Admin, Customer, Retailer, and Super Distributor cannot record that seat capability. An Admin cannot record it for a Retailer. The reason is `capability grantor is not configured`. A Distributor without the record receives `capability is not granted`.

`catalogGrants` stays empty for every role. A supplied permission is `permission is not granted` and is not stored. A different resource owner is `resource owner is outside scope`. One subject keeps one role. `Retailer+Customer` is `role scope denied`. A credential or bearer value is not stored. `liveTrading` stays `OFF` and `liveOrdersLocked` stays true. No PostgreSQL table was added. `packages/contracts/src/roles.mjs` and `services/shell-capabilities.mjs` were not changed.

## Evidence

`pnpm test:role-delegation` passed 3/3, duration_ms 203.196643. Super Admin registers `tenant-root`, `tenant-other`, `tenant-a`, `tenant-b`, and `tenant-a-child`. Admin cannot register a tenant. Super Admin delegates Admin and cannot delegate Super Admin or Distributor. Admin cannot delegate Admin, Super Admin, Super Distributor, or Customer, and cannot delegate Distributor into `tenant-b`. Admin delegates Distributor into `tenant-a-child` and Retailer into `tenant-a`. Super Distributor delegates nothing. A Distributor without a capability delegates nothing. Customer, Retailer, and Super Admin cannot record the Distributor capability. Admin records it once. The Distributor then delegates Retailer and Customer inside `tenant-a-child` and not into `tenant-b` or `tenant-a`. A second role for the same subject is `role is already recorded`. Permission `checklist.write` is `permission is not granted` and is not stored. Retailer cannot delegate Customer. `bearer fixture-token` is not stored. `pnpm test:roles` passed 2/2 and the six catalog lists stayed empty. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Super Distributor descendants, the Retailer seat-creation grantor, and commission ceilings are NOT IN SOURCE. Decision 0077 records combined Retailer and Customer profiles and does not change this delegation.
