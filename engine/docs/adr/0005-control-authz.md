# 0005 — Server-side control authorization

Status: accepted for task 1.B.2.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `services/control-api/src/authz/` and `packages/contracts/src/identity/`. This tree has no `services/control-api/` directory. `docs/architecture/target-map.md` already maps control-api work onto `engine/services/*.mjs` and says not to add that missing folder as a placeholder. ADR 0001 requires a new ADR before adding a directory.

| Manual path | File edited |
| --- | --- |
| `services/control-api/src/authz/` | `services/authz/` |
| `packages/contracts/src/identity/` | `packages/contracts/src/identity/model.mjs` (`isInSubtree`) and its exports |

Paths above are relative to `engine/`.

## Decision

1. `isInSubtree` walks from the target through `parentOf` and returns true only when it reaches the actor. The actor is in their own subtree. A cycle returns false.
2. `services/authz/evaluate.mjs` decides a control operation from the server directory and the route id. It does not import the UI, `access-policy.mjs`, or an HTTP handler. `authorizeRequest` stays the checklist HTTP gate from decision 0010.
3. Every capability name has one route id. `GET` and `POST /api/checklist-owner` match the only protected HTTP handlers. The `/api/control/*` ids are evaluator routes. This task does not mount them and does not add a connector, commission, wallet, or order handler.
4. The check order is: known route, server principal id, active principal, active actor tenant, a valid active role set, tenant subtree, principal subtree, then capability. An ancestor tenant or a principal outside the actor's descendant chain is `privilege escalation`. An unrelated tenant is `cross-tenant`. A missing or inactive principal, tenant, or assignment is `role revoked`. A missing capability is `capability denied`. The shipped role ceiling stays empty, so an allow grants nothing unless the caller passes a fixture ceiling. An explicit deny still wins.
5. Client `role`, `tenantId`, `editChecklist`, `canEdit`, `capability`, `password`, `token`, `cookie`, `proof`, `apiKey`, `seed`, and `authorization` are not read. A forged UI field cannot change the decision.
6. Privileged route ids append one audit row for a denial and for a grant. The row fields are `actor`, `action`, `target`, `decision`, and `reason`. Actor and target must be UUID ids or the word `redacted`. `checklist.read` is not privileged. This log is not `privileged_audit` from migration 0007. A privileged grant with nowhere to append the row is denied.

## Non-claims

- No secret, seed, order, or wallet value is stored.
- No LIVE market status is added.
- Catalog grant lists stay empty.
- Hiding a button is not this task. Decision 0010 still answers the checklist HTTP call.

## Evidence

- `tests/authz-matrix.mjs`
- `docs/architecture/evidence/1-b-2/`
