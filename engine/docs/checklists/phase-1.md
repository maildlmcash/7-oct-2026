# Phase 1 checklist — task 1.D.3

Recorded: 2026-10-07T13:02:44.254Z.
Owner: DLM CASH (GitHub `maildlmcash`).
Truth label: PAPER-SIMULATED for the desk, CONNECTED-READ-ONLY for the two public Binance sockets captured on the market screen.
Actor: desk Admin. Tenant: desk.

## Result

PASS

The device matrix, API authorization, accessibility, security audit, threat review, LIVE label evidence, and Lighthouse user flow all passed on a fresh run. The earlier heading failure and GHSA-7mvr-c777-76hp are cleared.

p2Activation: true

Live trading: OFF. Live orders locked: true. Wallet access: false. Real orders: false. Deployed: false. This pass does not unlock orders.

This checklist does not mark phase 1 complete. `docs/admin-checklist/phase-01-baseline.md` is unchanged. Phase 2 is not started by this record.

## a. Browser and device matrix

Supported viewports, from decision 0004 and `apps/web/tests/layout.spec.ts`: mobile 375×667, tablet 768×1024, desktop 1280×800.

The market card heading is `BTCUSDT · Top of book`. The lock check uses the exact banner text `LIVE ORDERS LOCKED`.

Command, from `engine/apps/web`: `corepack pnpm exec playwright test tests/layout.spec.ts tests/market-charts.spec.ts tests/shell-route.spec.ts --reporter=line`

6 passed (39.8s), exit 0. Evidence: `docs/architecture/evidence/1-d-3/layout-spec-rerun.txt`.

A live browser check the same day, after the spot symbol route was mounted, kept the market screen inside 375, 768, 1280, and 390. The trade table scrolls inside its card. axe-core on the dashboard, the market screen, and those mobile widths returned 0 violations. The console had no errors. The coin list showed 1334 coins.

## b. Threat model

Reviewed: auth, tenant boundary, admin edits, checklists, subdomain resolution. The signed-out shell still lists every section because it has no identity session. That listing is not a grant. Authorization was re-run for every close role and tenant. Evidence: `docs/architecture/evidence/1-d-3/threat-model-review.md` and `authz-rows.json`.

API authorization baseline: PASS. 140 decisions, 0 granted.

## c. LIVE labels

Lock copy cites `apps/web/health.mjs` and is not verified live. The two market status pills captured on screen include a socket source and an ISO-8601 last-seen time. Evidence: `docs/architecture/evidence/1-d-3/live-label-review.md`.

## Accessibility

axe-core on every shell section, on the seven role-navigation documents, and on the tenant preview cards in that shell: 0 violations. State: PASS.

## Security

`corepack pnpm audit --audit-level=high` from `engine` after `@playwright/test` 1.55.1: no known vulnerabilities. Exit 0. Critical count: 0. High count: 0. GHSA-7mvr-c777-76hp is cleared. Evidence: `docs/architecture/evidence/1-d-3/pnpm-audit-rerun.txt`.

## Lighthouse and Web Vitals

Lighthouse 12.8.2 user flow against the dev server. LCP 3116.20595 ms. INP 61.435 ms. CLS 0. Evidence: `docs/architecture/evidence/1-d-3/lighthouse-web-vitals.md`.

## Signed gate

`docs/architecture/evidence/1-d-3/signed-gate.json` is a checklist attestation with a SHA-256 checksum. No private key is stored. Orders stay locked.
