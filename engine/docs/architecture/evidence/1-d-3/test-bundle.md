# Test bundle — task 1.D.3

Recorded: 2026-10-07T13:02:44.254Z.
Owner: DLM CASH (GitHub `maildlmcash`).
Truth label: PAPER-SIMULATED.

## Commands and results

From `engine/apps/web`:

`corepack pnpm exec tsc --noEmit --incremental false` after `next typegen`: exit 0. `apps/web/next-env.d.ts` was restored to the dev type imports after typegen rewrote them.

`corepack pnpm exec playwright test tests/layout.spec.ts tests/market-charts.spec.ts tests/shell-route.spec.ts --reporter=line`

6 passed (39.8s). Exit 0. Raw log: `layout-spec-rerun.txt`.

An earlier full UI pass, excluding `tests/language.spec.ts`, was 21 passed (1.9m), exit 0. The six-test rerun above is the one after the coin list route, the overflow wrap, and the selected-coin contrast fix.

From `engine`:

`node --test` on the phase 1 node files including `tests/phase-1-close.mjs` and `tests/feed-evidence.mjs`: 40 passed, exit 0, before this gate file was rewritten. Re-run `tests/phase-1-close.mjs` after this file.

`corepack pnpm audit --audit-level=high`: no known vulnerabilities. Exit 0. Log: `pnpm-audit-rerun.txt`.

## Phase 2

`p2Activation` is true for this UI gate. Live trading stays OFF and live orders stay locked. This record does not start phase 2.
