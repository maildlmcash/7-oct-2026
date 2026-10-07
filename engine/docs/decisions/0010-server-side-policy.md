# 0010 — Server-side policy checks

Status: accepted for the web process.

## Context

TASK 04.B.01 asks for deny-by-default authorization on every protected API. Allowed scopes come from the authenticated principal, not from a client-supplied role id.

`services/shell-capabilities.mjs` already decides the checklist edit and the customer views. `POST /api/checklist-owner` was calling that check with the request body, so a client `actor.role` was the scope. `services/session.mjs` already identifies a subject from the `__Host-session` cookie. Accounts have no role. The source names no tenant-id format and no role catalog grant. TASK 04.B.02 defines role records and does not grant permissions. This task does not seed those roles and does not add login counters, alerts, or MFA.

## Decision

`services/access-policy.mjs` is the protected-resource gate. `bindPrincipal` stores a role and tenant for an existing account. `registerResource` stores a record id, tenant, and optional owner subject. Neither value is read from an HTTP body. An unbound principal, an unknown role, a missing record, and an unknown action deny.

`GET /api/checklist-owner` is `checklist.read`. `POST /api/checklist-owner` is `checklist.write`. The handler resolves the session cookie first. A missing, invalid, expired, or revoked session is HTTP 401 `{ ok: false, error: "login denied" }`, including a body that is not JSON. A session with no scope, the wrong tenant, an unknown record, or another subject's record is HTTP 403 `{ ok: false, error: "role scope denied" }`. Success stays `{ ok: true }`. The correlation id stays in `x-correlation-id` and is not added to that JSON.

`checklist.write` uses the existing same-tenant Admin rule against the server record's tenant. `checklist.read` allows the same-tenant Customer only when `ownerSubjectId` is that principal. Admin does not receive the customer read. Customer does not receive the write. Super Admin, Super Distributor, Distributor, and Retailer receive neither. Client `role`, `tenantId`, `editChecklist`, and `canEdit` are ignored.

The route authorizes only. It does not call `editChecklistOwner`. `writeChecklistOwner` still accepts an actor from server code. View-state, health, CSRF, login, reset request, and resend stay public. Session read, logout, and rotate already use the cookie.

The source names no session lifetime. `sessionRuntime.policy.ttlMs` stays null, so the running server cannot issue a session. Tests pass a fixture lifetime and bind the principal in process. No production admin is seeded.

## Evidence

`pnpm test:access-policy` covers unauthenticated rejection, a client role that must not grant a write, a server Admin allow, cross-tenant denial, unknown records, direct-object customer reads, expiry, revocation, and redaction. `pnpm test:shell` checks that the published page has no edit control and that both unauthenticated checklist posts return 401.
