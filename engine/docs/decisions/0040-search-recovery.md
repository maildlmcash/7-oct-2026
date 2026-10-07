# 0040 — Search recovery drill

Status: accepted for the in-memory snapshot and the recovery runbook. Alias rollback is refused.

## Context

TASK 09.C.02 asks to document snapshot and restore, alias rollback, partial outage behavior, and safe degraded UI behavior. The recovery drill must restore a test index and match checksums and counts. The runbook must have an owner and a last-tested date.

The test index is `services/search-documents.mjs`. TASK 09.B.02 remains BLOCKED, so no search alias, tombstone workflow, or `services/search-indexer/` directory exists. OpenSearch is not running. The source names no checksum algorithm and no operator name. The shell already keeps section navigation outside `SectionErrorBoundary`. A render failure shows `Section render failed`. A failed view-state request shows `Section request failed` and leaves the section content mounted. `apps/web/health.mjs` stays the frozen paper-mode health JSON.

## Decision

`services/search-recovery.mjs` copies the in-memory index, including document ids, visibility revisions, and the next id. The checksum is SHA-256 of the canonical JSON. That algorithm is an implementation choice. Restore replaces a damaged index with the snapshot. The restored count and checksum must match. One document is removed before restore, so the damaged count is lower and the restored count is the snapshot count. The latest visibility revision is part of the snapshot. A raw order-book field is rejected and is not stored.

`rollbackSearchAlias` returns `blocked` `BLOCKED` and error `search alias is not installed`. A caller-supplied alias name is rejected. The refusal does not change the restored checksum. The drill does not move an alias.

`docs/runbooks/search-recovery.md` records owner `fixture-owner` and last tested `2026-10-06`. The owner name is a drill fixture. A missing owner or an invalid date fails closed. The runbook states the shell rules above and that live trading stays OFF. The module does not add a shell section, does not open OpenSearch, and does not place an order. Decision 0041 stores analytical events on the named ClickHouse and Parquet path in memory and does not change this recovery drill.

## Evidence

`pnpm test:search-recovery` passed 3/3, duration_ms 242.918012. Two fixture documents restore with the same ids, count 2, and the same SHA-256 checksum after one document is removed. The damaged count is 1. The first document stays visible to Admin only. The Customer query returns the runbook document. A cross-tenant query returns an empty list. Alias rollback is `search alias is not installed`, and the checksum stays the same. The runbook file matches the drill text and contains `Owner: fixture-owner` and `Last tested: 2026-10-06`. A bid and ask field returns `raw order book` and leaves no checksum. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
