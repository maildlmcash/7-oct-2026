# 0011 — Role name definitions

Status: accepted for the role catalog.

## Context

TASK 04.B.02 asks for Super Admin, Admin, Super Distributor, Distributor, Retailer, and Customer as role definitions only. Broad permissions wait for the dedicated role phase and approval matrix. That phase is TASK 17.A.01.

Design section 25 names those six roles and says the default is deny. It also names global policy, tenant administration, subtree delegation, commission, other users' data, and connector secrets. This task does not implement those scopes.

`SHELL_ROLES` in `services/shell-capabilities.mjs` already used the six names. Accounts still have no role until server code binds one. Decision 0010 is unchanged.

## Decision

`packages/contracts/src/roles.mjs` is the API contract, exported as `@crypto-prediction-engine/contracts/roles`. `data/migrations/0006_role_definitions.sql` stores the same names in `role_definition`. The name is the primary key. Unknown names are rejected. There is no permission table.

Customer is the only default. Every role has catalog permissions none.

| Role | Default | Catalog permissions |
| --- | --- | --- |
| Super Admin | no | none |
| Admin | no | none |
| Super Distributor | no | none |
| Distributor | no | none |
| Retailer | no | none |
| Customer | yes | none |

The default role is Customer. Its catalog grant list is empty, which is the minimum. Design section 25 scopes stay not granted.

This catalog does not change `authorizeShell` or `authorizeRequest`. A same-tenant Admin can still edit a checklist. A same-tenant Customer can still read an owned checklist and see the user checklist and market views. The other four roles still receive neither. Login does not assign the default role.

## Evidence

`pnpm test:roles` compares the contract, the migration text, the decision table, and the empty grant lists. `pnpm test:shell-capabilities` and `pnpm test:access-policy` cover the existing checks. Applying `0006_role_definitions.sql` needs `psql`, which this environment does not have.
