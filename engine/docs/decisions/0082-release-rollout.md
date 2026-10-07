# 0082 — Staged rollout and rollback

Status: accepted for an in-memory staged rollout. A failed health stage halts later stages. Rollback restores the prior build and keeps paper and audit evidence. This module does not deploy. Live trading stays OFF and live orders stay locked.

## Context

TASK 18.C.01 asks for staged rollout, health gates, feature flags, rollback, and migration safety. `LIVE_TRADING` stays `OFF` and `LIVE_ORDERS_LOCKED` stays true by default. A canary failure must halt rollout. A rollback drill must restore the prior build and data compatibility.

Design section 20 starts paper-only. The sequence is schema migrations, readiness, ingest and workers, data health, Hub/API, then web assets. The release manifest records a source hash, a schema version, adapter versions, and model, feature, risk, and commission config versions, plus test evidence. Environments are dev, test, staging, and prod. Credentials stay separate and are not stored here. Migrations use expand/contract. An application rollback does not delete paper or audit evidence. New order intents stop, and uncertain orders are reconciled, before a rollback that affects execution. The source names no canary percentage and no deploy command. Decision 0019 records the release gate and does not deploy. Decision 0075 copies live flags from the frozen health object.

## Decision

`services/release-rollout.mjs` exports `ROLLOUT_STAGES`, `RELEASE_ROLLOUT_LIMITATIONS`, `createReleaseRollout`, `recordReleaseManifest`, `recordSchemaMigration`, `recordRolloutStage`, `recordReleaseEvidence`, `recordUncertainOrder`, `reconcileUncertainOrder`, `stopOrderIntents`, `rollbackRelease`, and `readReleaseRollout`.

The only feature flags are `LIVE_TRADING` and `LIVE_ORDERS_LOCKED`, copied from `apps/web/health.mjs`. A different caller value is `live mode cannot be enabled` and is not stored. Any other flag is `feature flag is not configured` and is not stored. A canary percentage is `canary percentage is NOT IN SOURCE` and is not stored. A failed stage, including readiness and data health, sets `canaryHalted`. A later stage returns `rollout is halted`. `deployed` stays false. `served` stays false until every stage has passed and that build is still current.

An expand migration keeps the prior schema in the compatibility list. A contract is not applied while a prior build remains. A drop of paper or audit evidence is refused, and those rows stay at the same index. Rollback requires stopped intents and a reconciliation for every uncertain order. It appends the prior source hash and schema version as the current build. Evidence rows are not removed. Another environment does not take that build. Same-tenant Admin is the only actor. No PostgreSQL table was added. `apps/web/health.mjs` and `services/release-gate.mjs` were not changed.

## Evidence

`pnpm test:release-rollout` passed 3/3, duration_ms 181.912347. A readiness failure and a data-health failure set `canaryHalted` and leave `served` false. The following ingest or Hub/API stage returns `rollout is halted`. A caller percentage `fixture-canary-share` is not stored. Flag `fixture-flag` is not stored. `LIVE_TRADING` `ON` is `live mode cannot be enabled`, and the result stays `OFF` and locked.

Build `fixture-build-1` on schema `fixture-schema-1` becomes current. A later schema without an expand is `migration is not compatible` and does not replace that build. A contract that drops `audit` is `audit evidence is kept`. A contract with no drop is `prior build is still compatible`. An expand from `fixture-schema-1` to `fixture-schema-2` keeps both versions. Build `fixture-build-3` then becomes current. Rollback before intents stop is `new order intents are not stopped`. Rollback with order `fixture-order` still uncertain is `uncertain orders are not reconciled`. After the stop and the reconciliation, the current hash returns to `fixture-build-1` and the schema returns to `fixture-schema-1`. Paper `fixture-paper` and audit `fixture-audit` stay at the same indexes. The compatibility list still contains both schema versions. Prod has no current hash. These ids are fixtures.

A Customer and a cross-tenant Admin write nothing. `bearer fixture-token` is not stored. `apiKey` is `live credentials are not allowed` and is not stored. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. A canary percentage, a deploy command, and human release approval are not in this module. Decision 0083 records the final human release checklist and does not change this rollout.
