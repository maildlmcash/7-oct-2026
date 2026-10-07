# 0011 — Secret reference workflow

Status: accepted for task 1.D.2.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/features/credentials/`, `services/control-api/src/secrets/`, and `docs/security/`. This tree has no `apps/control-web/` directory and no `services/control-api/` directory. `docs/security/` exists and already holds the role matrix.

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/features/credentials/` | `apps/web/app/features/credentials/` |
| `services/control-api/src/secrets/` | `services/secrets/` |
| `docs/security/` | `docs/security/secret-reference-threat-model.md`, `docs/security/key-permission-checklist.md` |

Paths above are relative to `engine/`. `services/privileged-access.mjs` and the capability catalog stay as they are. This task does not add an HTTP route.

## Decision

1. The screen shows reference metadata and permission scope. Secret material is not a stored field. In this paper-only deployment the write path is not enabled. If a caller submits material, the service drops it and records a denial.
2. A reference names a secret-manager path and a KMS key slot. The KMS slot is not configured. Rotation is not enabled. Revocation changes reference metadata only. The audit row is actor, action, target, decision, and reason.
3. Withdrawal is `BLOCKED`. Trade is `UNAVAILABLE`. `LIVE_TRADING` stays `OFF` and `LIVE_ORDERS_LOCKED` stays `true`. Material cannot be retrieved. Logs and telemetry use the audit fields and omit material keys.

## Non-claims

- No exchange credential, wallet key, live order, or customer balance is stored.
- No LIVE market status is added.
- Catalog grant lists stay empty. `connector.secret` remains a name with no value.
- No KMS or secret-manager client is connected.

## Evidence

- `tests/secret-reference.mjs`
- `apps/web/tests/secret-reference.spec.ts`
- `docs/security/secret-reference-threat-model.md`
- `docs/security/key-permission-checklist.md`
- `docs/architecture/evidence/1-d-2/`
