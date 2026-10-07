# 0051 — Model registry and rollback

Status: accepted for an in-memory Spot model lineage. Promotion requires evaluation evidence and a different Admin. No order is placed.

## Context

TASK 11.C.02 asks to register the model artifact, code, data, and feature versions, the training window, the evaluation report, the owner, and the approval. The prior model must stay available for rollback. Promotion is denied without the required evidence. Rollback restores the prior version and writes an audit event.

Design page 11 says production weights are versioned and auto-learning does not change them. Design page 14 records an audit as actor, before, after, reason, approval, timestamp, and config checksum. The provider registry already uses a same-tenant Admin grant, denies a maker who approves their own change, and keeps an append-only audit. Decision 0050 produces the walk-forward report used as evaluation evidence. The source names no owner identity, no artifact format, and no checksum algorithm.

## Decision

`services/model-registry.mjs` exports `createModelRegistry`, `registerModel`, `promoteModel`, `rollbackModel`, `readCurrentModel`, and `readModelVersions`. Registration stores one immutable candidate for a lineage: artifact, code version, data version, feature version, model version, dataset, Spot horizon, training window, owner, and the evaluation report when it is supplied. A report that is present must be a successful walk-forward result for that same model, feature version, dataset, and horizon. A false or mismatched report is not stored.

Promotion is a second step by a same-tenant Admin who is not the proposer. Without a stored evaluation report, promotion returns `evaluation evidence is required`, leaves the current model unchanged, and writes no audit. The first promotion makes that version current. A later promoted version becomes current, and the earlier version remains in the lineage. Rollback selects a prior promoted version, makes it current again, and appends an audit event with the before and after snapshots. The superseded version is not deleted. A version that was never promoted cannot be the rollback target. Audit rows are frozen. The registry checksum is SHA-256 of the canonical registration body, the same algorithm already used for a pinned snapshot. The module does not place an order and does not enable live trading. No PostgreSQL table was added. Decision 0052 records the contract specification and does not change this registry.

## Evidence

`pnpm test:model-registry` passed 3/3, duration_ms 327.453741. The stored evaluation is a real `evaluateWalkForward` report: one included row nets `-199/6375` and the score model is `fixture-baseline`. The proposer cannot promote it, and that denial writes no audit. A second Admin promotes it. A second model, `fixture-baseline-2`, can then be promoted while the first version remains readable. Rollback restores the first version id, leaves the second version in the lineage, and appends an audit action `rollback` whose before snapshot is `fixture-baseline-2` and whose after snapshot is `fixture-baseline`. The first audit row stays frozen. A candidate with no evaluation is denied at promotion and cannot be rolled back. A report whose model version differs is `evaluation does not match the model` and is not stored. A missing Brier field is `evaluation evidence is required`. A blank owner, a blank artifact, a missing training window, and a horizon outside the Spot list are rejected. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Owner `fixture-owner`, artifact `fixture-artifact`, code version `fixture-code`, and data version `fixture-data` are fixtures and are NOT IN SOURCE.
