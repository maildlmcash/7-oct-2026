# 0001 — Baseline inventory and module boundaries

Status: accepted as the task 1.A.1 inventory record. The blockers below stay open.

Task: 1.A.1 Create a baseline inventory and architecture decision.
Date: 2026-10-07.
Repository: `maildlmcash/7-oct-cgpt-code` at `9efafef2ed5ffd1baea0d81eb06200c367d2713f`.

## Owners

| Role | Name | Basis |
| --- | --- | --- |
| Repository owner | DLM CASH \<maildlm.cash@gmail.com\> (GitHub `maildlmcash`) | Author of `HEAD` and owner of the GitHub repository. |
| Baseline recorder | Task 1.A.1 session | Wrote this ADR from the command transcripts in `docs/architecture/evidence/1-a-1/`. |
| Separate countersignature | Not attached | No additional signature file was provided. The owner above is the named owner. |

## Context

The phase manual's target map (`apps/control-web`, `services/control-api`, `services/market-gateway`, `services/scoring`, `services/paper-engine`, `packages/ui`, `infra`, `docs/adr`) does not match this tree. Existing decisions already live in `docs/decisions/`, including `docs/decisions/0001-approved-boundaries.md`. That older decision stays in force for live-order lock and the web app boundary. This ADR does not replace it. It records what the commands printed on this date and where later tasks must edit.

Paths in this ADR are relative to `engine/` unless they say "git root".

## Decision

1. The product root for phase 1 remains `engine/`. The git root TanStack app is a host that mounts `apps/web/app/shell.tsx`. It is not a second control plane.
2. Do not create the missing target directories in this task. The path map is `docs/architecture/target-map.md`.
3. Do not edit package manifests or lockfiles. The root lockfile is already out of sync, and changing it would erase the measured failure.
4. `LIVE_TRADING` stays off and live orders stay locked. This inventory did not connect a venue and did not place an order.
5. New phase-1 work uses the existing boundaries: `apps/web`, `packages/contracts`, `packages/ui-kit`, `services/*.mjs`, `data/migrations`, and `docs/decisions`. A task that needs a new directory writes its own ADR first.

## Command record

These lines are the measured results. The transcripts are the files named here.

| Transcript | Exit | Line that must stay true |
| --- | --- | --- |
| `docs/architecture/evidence/1-a-1/toolchain.txt` | n/a | `node: v22.23.3` |
| `docs/architecture/evidence/1-a-1/root-npm-ci.txt` | 1 | `Invalid: lock file's ajv@6.15.0 does not satisfy ajv@8.20.0` |
| `docs/architecture/evidence/1-a-1/root-typecheck.txt` | 127 | `sh: tsc: command not found` |
| `docs/architecture/evidence/1-a-1/root-test.txt` | 1 | `Cannot find package '@tanstack/react-start'` and `Cannot find package 'jose'` |
| `docs/architecture/evidence/1-a-1/engine-install.txt` | 0 | `Done in 24.4s using pnpm v10.17.1` |
| `docs/architecture/evidence/1-a-1/engine-typecheck.txt` | 1 | `app/cex-desk.tsx(128,52): error TS7006: Parameter 'place' implicitly has an 'any' type.` |
| `docs/architecture/evidence/1-a-1/engine-test.txt` | 0 | `# tests 268`, `# pass 267`, `# fail 0`, `# skipped 1` |
| `docs/architecture/evidence/1-a-1/engine-audit.txt` | 1 | `GHSA-7mvr-c777-76hp` |

Stack support and licenses: `docs/architecture/stack-versions.md`.
File inventory: `docs/architecture/baseline-inventory.md`.

## Unresolved blockers

| Id | Owner | Blocker | Retry |
| --- | --- | --- | --- |
| B1 | Repository owner | Git-root `package-lock.json` does not match `package.json`. `npm ci` exits 1. Root `tsc` is absent, so `npm run typecheck` exits 127. Two root tests cannot import `@tanstack/react-start` or `jose`. | One lockfile refresh, then re-run `npm ci`, `npm run typecheck`, and `npm test`. Not done in 1.A.1. |
| B2 | Repository owner | `corepack pnpm typecheck` exits 1 at `apps/web/app/cex-desk.tsx(128,52)` TS7006 (`place` implicit any). `next typegen` also rewrites `apps/web/next-env.d.ts`; that rewrite was reverted after measurement. | Fix the parameter type in a later task, then re-run typecheck. |
| B3 | Repository owner | `corepack pnpm audit` exits 1. One high finding: playwright `<1.55.1`, CVE-2025-59288, GHSA-7mvr-c777-76hp. Installed `@playwright/test` is 1.49.1. | Upgrade only with a dedicated change and a re-run of the shell tests. Not done here. |
| B4 | Repository owner | Node.js 22.23.3 is Maintenance LTS until 2027-04-30, not Active LTS. No `engines` field pins it. | Decide whether later deploys move to Node 24. Not a failure of this inventory. |
| B5 | Repository owner | Database migration tests and the live market smoke were not run. Smoke stays skipped unless `RUN_LIVE_MARKET_SMOKE=1`. | Do not mark either CONNECTED or PASS. |

## Non-claims

- No screen was marked LIVE.
- No exchange secret, wallet key, or order was read or sent.
- `docs/decisions/0001-approved-boundaries.md` is unchanged.
- Task 1.A.2 is not started.

## Evidence

- `docs/architecture/baseline-inventory.md`
- `docs/architecture/target-map.md`
- `docs/architecture/stack-versions.md`
- `docs/architecture/evidence/1-a-1/`
- `tests/baseline-inventory.mjs` checks that this ADR still quotes the transcripts.
