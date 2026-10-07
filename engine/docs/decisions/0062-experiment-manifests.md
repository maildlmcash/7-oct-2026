# 0062 — Experiment manifests

Status: accepted for an immutable in-memory run record. A rerun resolves the recorded versions. The seed is not used to draw a number. No order is placed.

## Context

TASK 13.C.01 asks to persist the code SHA, model version, data version, feature version, config, random seed, run id, and output checksum for every experiment.

The source names no experiment table and no seed width. SHA-256 is the checksum already used for a pinned snapshot. Decision 0061 reports windows and does not register a run.

## Decision

`services/experiment-manifests.mjs` exports `createExperimentStore`, `registerExperiment`, `readExperiment`, and `resolveExperimentRerun`. One run stores the code SHA, model version, data version, feature version, config, config checksum, seed, run id, and output checksum. The output checksum must be 64 lowercase hex characters. The config checksum is SHA-256 of the canonical config. The stored manifest, including nested config, is frozen. A later edit of the caller's config does not change the stored copy. `seedUsed` stays false. The same run id and the same body return the stored manifest. A different body is `experiment is already recorded`. A missing version or a checksum that is not 64 hex fails closed and stores nothing.

`resolveExperimentRerun` returns the recorded code SHA, model version, data version, feature version, config, seed, and output checksum. It checks the config checksum again. A missing run, a blank model version, or a config checksum that does not match returns `resolved` false and null version fields. The seed is not used to draw a number. No PostgreSQL table was added. The module does not place an order.

## Evidence

`pnpm test:experiment-manifests` passed 3/3, duration_ms 237.330161. Run `fixture-run` stores code SHA `a67aca9027167448f60de9abebca9e94cf43d325`, model `fixture-model`, data `fixture-data`, features `fixture-features`, seed `fixture-seed`, and `seedUsed` false. The output checksum is the SHA-256 of the fixture text `fixture-output`. A rerun resolves those same versions and the frozen config. Changing the caller's nested config after registration leaves the stored horizon `fixture-horizon` and lookback `fixture-lookback`. Assigning a new seed on the frozen manifest throws. A blank feature version is `feature version is not configured`. Checksum `abcd` is not echoed. A second seed does not replace the first, and the rerun still resolves `fixture-seed`. A missing run and a blank model version resolve nothing. A config checksum of `ab` repeated does not resolve the feature version. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The run id, versions, and seed are fixtures and are NOT IN SOURCE. Decision 0063 records the leakage review and does not change these manifests.
