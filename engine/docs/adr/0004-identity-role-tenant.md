# 0004 — Role and tenant data model

Status: accepted for task 1.B.1.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `data/migrations/` and `packages/contracts/src/identity/`. Both exist under `engine/`. This task does not add a second database or a second role catalog.

| Manual path | File edited |
| --- | --- |
| `data/migrations/` | `data/migrations/0014_identity_role_tenant.sql` and its rollback |
| `packages/contracts/src/identity/` | `packages/contracts/src/identity/` |

Paths above are relative to `engine/`. `role_definition` from migration 0006 and `tenant` from migration 0001 stay in place. Catalog grant lists in `packages/contracts/src/roles.mjs` stay empty.

## Decision

1. A tenant has a nullable parent tenant and a status of `active`, `suspended`, or `closed`. A principal belongs to one tenant. A role assignment stores that same tenant, one of the six role names, an optional parent principal, and a status.
2. The parent foreign key is `(parent_principal_id, tenant_id) → identity_principal (id, tenant_id)`. A child cannot point at a principal in another tenant. The principal foreign key uses the same pair.
3. One principal may hold Retailer and Customer together. Any other pair is `profile is not combined`. That pair is not a seventh role.
4. Capability names are `checklist.read`, `checklist.write`, `global.policy`, `tenant.admin`, `subtree.delegate`, `commission.manage`, `other-user.read`, and `connector.secret`. The last name is a label. The table has no secret value. No allow row is inserted. The shipped role ceiling is empty, so an allow outside that ceiling does not grant. An explicit deny removes a capability from the union of the held roles.

## Non-claims

- Login does not assign a role.
- `authorizeShell` and `authorizeRequest` are unchanged.
- No order, wallet, or secret value is stored.
- No LIVE market status is added.
- This task does not treat a hidden button as authorization. The API denial for every hidden action is a later section B task.

## Evidence

- `tests/identity-schema.mjs`
- `docs/architecture/evidence/1-b-1/`
