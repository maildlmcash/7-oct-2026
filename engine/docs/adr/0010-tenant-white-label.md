# 0010 — Subdomain tenant and white-label design

Status: accepted for task 1.D.1.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `services/control-api/src/tenants/` and `apps/control-web/src/branding/`. This tree has no `services/control-api/` directory and no `apps/control-web/` directory. ADR 0002 keeps one shell on pathname `/app`. ADR 0005 keeps control evaluation in `services/`.

| Manual path | File edited |
| --- | --- |
| `services/control-api/src/tenants/` | `services/tenants/` |
| `apps/control-web/src/branding/` | `apps/web/app/branding/` |

Paths above are relative to `engine/`. Migration `0014` and the role catalog stay as they are. This task does not add a route and does not rewrite `/app`.

## Decision

1. A host is trusted only from the request `Host` header. `X-Forwarded-Host` and `X-Original-Host` are accepted only when they name that same host. Any other value is host spoofing and applies no theme.
2. The host is compared to a frozen allowlist of three preview tenants. An unknown host applies no theme. The signed theme's tenant, host, and subdomain must equal the allowlist row. A requested tenant that differs is a tenant mismatch. A user's tenant or subdomain that differs is a user-subdomain mismatch.
3. Logo text, color, help links, and feature flags come from that signed record. The signature is Ed25519 over a canonical payload. The public key is in the service. The private key is not stored. A changed byte fails verification.
4. Help links are `https` only, with no user info and no query. Feature flags cannot turn on trading, orders, wallet access, or exchange credentials. Those stay off. The screen pathname stays `/app`.

## Non-claims

- No exchange credential, wallet key, live order, or customer balance is stored or activated.
- No LIVE market status is added.
- Catalog grant lists stay empty.
- The three tenants are MOCK preview names, not a production customer directory.

## Evidence

- `tests/tenant-white-label.mjs`
- `apps/web/tests/tenant-brand.spec.ts`
- `docs/architecture/evidence/1-d-1/`
