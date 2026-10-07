# 0009 — Operational readiness metrics

Status: accepted for task 1.C.3.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/features/health/` and `packages/contracts/src/telemetry/`. This tree has no `apps/control-web/` directory. ADR 0002 keeps the shell in `apps/web`.

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/features/health/` | `apps/web/app/features/health/` |
| `packages/contracts/src/telemetry/` | `packages/contracts/src/telemetry/` |

Paths above are relative to `engine/`. `services/search-metrics.mjs`, `services/session.mjs`, `apps/web/page-health.mjs`, and migration `0004` stay as they are. Design section 22 starting targets are not copied. The desk login fixture cap is not copied.

## Decision

1. Each readiness metric shows owner, target, measured value, limit, source, sample window, and breach. The families are latency, uptime, rate limits, security, and device errors.
2. The source names no numeric SLO, no sample window, and no operational owner. Those fields stay unconfigured. The owner displays `UNKNOWN`. Breach is `UNKNOWN` unless a caller supplies both a target and measured evidence.
3. A missing measurement, or a measurement without a configured target, is `UNKNOWN`. `UNKNOWN` is not a pass. The screen does not paint it green and does not mark an invented threshold passed.
4. Observed p50, p95, and p99 are copied from a search-metrics report when one exists. Freshness, disconnects, rate-limit headroom, and security checks stay `UNKNOWN` while their telemetry is absent. Headroom uses the session rule: a missing cap is `rate limit is not configured`.
5. Synthetic checks are views for page, login, resend-password, and layout, on browser and mobile. No recorded result is `UNKNOWN`. A recorded failure is `FAIL`. A pass result is rejected.
6. The screen mounts in the Admin section. The shell already limits that section to the desk Admin role. Catalog grants stay empty. Truth label is MOCK.

## Non-claims

- No exchange credential, wallet key, or live order is stored.
- No LIVE market status is added.
- No product SLO is invented.
- The screen does not open a socket, place an order, or read a wallet.

## Evidence

- `tests/readiness-metrics.mjs`
- `apps/web/tests/readiness-metrics.spec.ts`
- `docs/architecture/evidence/1-c-3/`
