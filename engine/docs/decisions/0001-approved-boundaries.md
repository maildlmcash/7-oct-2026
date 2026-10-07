# 0001 — Approved boundaries and deferred choices

Status: accepted for the current repository baseline.

## Context

Design section 18 names the web stack as Next.js, React, and TypeScript. It defers Rust to a profiled hot path. Design section 19 names a larger tree, including mobile, services, and separate Spot and Futures execution paths. Design section 2 allows a modular monolith for an MVP and keeps exchange adapters and execution credentials in separate process boundaries.

`docs/dependency-map.md` records the paths that exist today.

## Decision

The implemented application boundary is `apps/web`. `packages/contracts` and `packages/ui-kit` stay package boundaries with no source. `LIVE_TRADING` stays `OFF`. `LIVE_ORDERS_LOCKED` stays `true`. Paper mode stays the standing rule in `STANDING_RULES.md`. This task does not add a paper-book module.

Rust workers are not added. No measured bottleneck is in the repository. Spot and Futures stay separate, and both are absent. The section 19 services, mobile app, database, event bus, and search index are deferred to their own tasks.

The health contract is `apps/web/health.mjs`. `pnpm health` checks that contract. It does not open a network connection.

## Trade-offs

A fixed health contract can be checked offline and returns the same bytes on every run. It does not prove that an exchange, a database, or a worker is up. Those checks wait until those processes exist.

Keeping the tree to the web shell avoids speculative services. Normalization, scoring, prediction, and paper-book output remain blocked. That block is recorded in `docs/dependency-map.md`.

## Evidence

- `docs/dependency-map.md`
- `apps/web/package.json` depends on `next`, `react`, and `react-dom`
- `pyproject.toml` declares no Python packages
- No Rust crate or worker directory is present
- `pnpm health` prints `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}` and exits 0
