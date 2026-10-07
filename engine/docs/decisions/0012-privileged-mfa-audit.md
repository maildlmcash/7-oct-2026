# 0012 — Privileged MFA readiness and audit

Status: accepted for the web process.

## Context

TASK 04.C.01 asks privileged actions to require MFA where an identity provider exists, and to record actor, action, target, reason, and time in an append-only audit. The source names no identity provider, no MFA header, and no proof format.

`POST /api/checklist-owner` is the privileged write. Checklist read is not. `audit_record` remains the checklist audit. Reset and OTP keep their own audit. This task does not add login counters.

## Decision

`services/privileged-access.mjs` gates `checklist.write` after the server principal is allowed. `sessionRuntime.mfaProvider` is null. A null provider returns HTTP 503 `{ ok: false, error: "mfa provider is not configured", blocked: "BLOCKED" }`. A test may inject a provider. A missing proof is `mfa required`. A rejected proof is `mfa denied`. A verified proof allows `{ ok: true }`. The header `x-mfa-proof` is an implementation choice. The proof is not stored.

Each privileged attempt appends one frozen event with `actor`, `action`, `target`, `reason`, and `time`. Search returns copies. Update and delete are refused. `data/migrations/0007_privileged_audit.sql` stores the same fields as `recorded_at` and rejects update, delete, and truncate. It has no secret column.

Customer reads and unauthorized writes do not write this audit. Live trading stays off.

## Evidence

`pnpm test:privileged-access` covers the missing provider, a fixture provider, search, immutability, and redaction. `pnpm test:access-policy` covers the blocked admin write. Applying `0007_privileged_audit.sql` needs `psql`, which this environment does not have.
