# Baseline inventory (task 1.A.1)

Measured 2026-10-07 at git `9efafef2ed5ffd1baea0d81eb06200c367d2713f`.
Author on that commit: DLM CASH <maildlm.cash@gmail.com>.
Remote: `https://github.com/maildlmcash/7-oct-cgpt-code.git`, branch `main`.
Working tree was clean before this task's documents were added.

Command transcripts: [evidence/1-a-1](./evidence/1-a-1/).

## What this repository actually is

One git repository with two application roots.

| Root | Manifest | Role seen in the tree |
| --- | --- | --- |
| repository root | `package.json` (`app-builder-workspace`), `package-lock.json` | TanStack Start shell. `src/routes/index.tsx` mounts the engine `Shell`. |
| `engine/` | `engine/package.json` (`crypto-prediction-engine`), `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Product workspace the phase manual describes. |

`engine/pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Product tree under `engine/`

| Path | Count or contents |
| --- | --- |
| `apps/web` | Next.js app. UI shell is `apps/web/app/shell.tsx`. Route handlers live under `apps/web/app/api/`. |
| `packages/contracts` | Shared view-state, roles, and trader-input modules. |
| `packages/ui-kit` | Layout primitives (`layout.tsx`, `layout.css`). |
| `services/` | 87 `.mjs` modules. Public venue adapters, paper ledger, checklist, and release checks are files here, not separate service directories. |
| `tests/` | 102 `.mjs` files before `tests/baseline-inventory.mjs`. |
| `data/migrations/` | 27 SQL files plus a README. |
| `docs/decisions/` | 83 accepted decision records, `0001` through `0083`. |
| `docs/adr/` | Did not exist before this task. |
| `docs/architecture/` | Did not exist before this task. `docs/dependency-map.md` is the older integration map. |
| `pyproject.toml` | Comment only. No Python packages and no Python lockfile. |
| `infra/` | Not present. |

## Workspace shell at the git root

`src/routes/` has one page, `index.tsx`, plus `__root.tsx` and `src/routes/api/*` proxies for public market reads. `migrations/` at the git root contains only `migrations/auth/0001_auth.sql`. Root `node_modules` was not installed. See the `npm ci` transcript.

## Commands that exist

Workspace root `package.json`:

- `dev` — `node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8080`
- `build` — vite build, then `npm run db:migrate`
- `typecheck` — `tsc --noEmit`
- `test` — node:test on `scripts/**/*.test.mjs` and four `src/lib` tests

Engine `package.json` (`packageManager`: `pnpm@10.17.1`):

- `dev` / `build` / `start` — `pnpm --filter web`
- `test` — `node scripts/test-offline.mjs` (every `tests/*.mjs` except `*migration*` and `checklist-schema.mjs`)
- `test:database` — migration tests, not run in this baseline
- `test:network` — live Binance smoke, not run
- `typecheck` — `pnpm --filter web typecheck`
- `health` — `node scripts/health-smoke.mjs`, not run in this baseline

## Baseline command results

| Command | cwd | Exit | Result |
| --- | --- | --- | --- |
| `npm ci --no-audit --no-fund` | repo root | 1 | Lockfile out of sync (`ajv`, `fast-uri`, `json-schema-traverse`, `require-from-string`). |
| `npm run typecheck` | repo root | 127 | `sh: tsc: command not found` |
| `npm test` | repo root | 1 | 197 script tests passed. App suite 6 pass, 2 fail: missing `@tanstack/react-start` and `jose`. |
| `corepack pnpm install --frozen-lockfile` | `engine/` | 0 | 33 packages, lockfile already up to date. |
| `corepack pnpm typecheck` | `engine/` | 1 | `app/cex-desk.tsx(128,52): error TS7006: Parameter 'place' implicitly has an 'any' type.` |
| `corepack pnpm test` | `engine/` | 0 | 268 tests, 267 pass, 0 fail, 1 skip. |
| `corepack pnpm audit --json` | `engine/` | 1 | 1 high advisory. 0 critical, 0 moderate, 0 low. |

The skipped engine test is the public book ticker smoke. It runs only when `RUN_LIVE_MARKET_SMOKE=1`. This baseline did not set that variable. The skip is not a connected-market result.

`pnpm test:database` was not run. No PostgreSQL service was configured for this measurement.

## Safety labels for this inventory

| Surface | Label |
| --- | --- |
| Engine offline tests | REPLAY of in-repo fixtures. Not a live venue. |
| Skipped market smoke | BLOCKED on the opt-in env flag. Not CONNECTED-READ-ONLY. |
| Root app tests that need installed packages | BLOCKED. The lockfile does not install. |
| Exchange order placement | Not executed. Standing rule remains paper mode, live orders locked. |
