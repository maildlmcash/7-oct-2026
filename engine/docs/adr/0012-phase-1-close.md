# 0012 — Phase 1 closeout gate

Status: accepted for task 1.D.3.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/`, `services/control-api/`, and `docs/checklists/phase-1.md`. This tree has no `apps/control-web/` directory and no `services/control-api/` directory. `docs/checklists/` was absent. ADR 0001 forbids adding those missing product trees as a second app or a second API. ADR 0002 keeps the shell in `apps/web`. ADR 0005 keeps control evaluation in `services/`.

| Manual path | File used |
| --- | --- |
| `apps/control-web/` | No new screen. The browser matrix stays `apps/web/tests/layout.spec.ts`. |
| `services/control-api/` | `services/phase-gates/phase-1-close.mjs` |
| `docs/checklists/phase-1.md` | `docs/checklists/phase-1.md` |

Paths above are relative to `engine/`. `services/release-gate.mjs` and `services/release-approval.mjs` stay as they are. This task does not add an HTTP route, does not deploy, and does not edit `docs/admin-checklist/phase-01-baseline.md`.

## Decision

1. The closeout record evaluates, in order: the supported browser matrix, API authorization, accessibility, security severity, the threat-model review, visible LIVE labels, and Lighthouse / Web Vitals. The first failed or unresolved check is the recorded result. Later gaps stay on the record and do not replace that first check.
2. A failed test is `FAIL`. A check that was not run, not measured, or missing source evidence is `BLOCKED`. `p2Activation` is true only when every check is `PASS`. `LIVE_TRADING` stays `OFF` and `LIVE_ORDERS_LOCKED` stays true even then. A pass does not unlock orders or wallet access.
3. A visible status label whose text is LIVE needs a source string and an ISO-8601 `lastSeen` timestamp. A relative age such as `12s` is not that timestamp. Lock copy (`LIVE ORDERS LOCKED`) cites the frozen health object, is not an observation, and is not verified live.
4. The attestation is a checklist record: actor, time, result, evidence paths, and a SHA-256 checksum of the decision. No private key is stored. Decision 0019 still names no deploy signature.

## Supported matrix

Decision 0004 names the viewports already implemented by `apps/web/tests/layout.spec.ts`: mobile 375×667, tablet 768×1024, desktop 1280×800. Those pixels are fixtures. This task does not add a heading to satisfy that file.

## Non-claims

- No exchange credential, wallet key, live order, or customer balance is stored.
- No LIVE market status is marked verified.
- Catalog grant lists stay empty.
- Playwright is not upgraded. Typecheck is not claimed green.
- Gallery axe from task 1.A.3 is not an accessibility pass for every role and tenant.

## Evidence

- `tests/phase-1-close.mjs`
- `docs/checklists/phase-1.md`
- `docs/architecture/evidence/1-d-3/`

## Addendum — 2026-10-07 later the same day

The sentences above, “This task does not add a heading” and “Playwright is not upgraded. Typecheck is not claimed green,” record the first close attempt. That attempt failed. The repair added the heading `BTCUSDT · Top of book`, set `@playwright/test` to 1.55.1, and the web typecheck then exited 0. Those repairs do not unlock orders, do not start phase 2, and do not mark `docs/admin-checklist/phase-01-baseline.md` complete.
