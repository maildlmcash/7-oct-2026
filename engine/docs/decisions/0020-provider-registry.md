# 0020 — Provider registry

Status: accepted for versioned provider records.

## Context

TASK 06.A.01 asks for versioned records for CEX, DEX, chain, market-data API, and WebSocket endpoints. Each record carries product, channel, docs reference, region, limits, heartbeat, status, and last error. Create, update, archive, and version must be covered by schema and API tests. Every mutation is audited.

Design section 3 names an Admin source registry. Same-tenant Admin is the existing editor. The source names no numeric rate limit, no heartbeat interval, and no provider status vocabulary. Secret storage, connection tests, and config approval are later tasks. Decision 0001 stays unchanged.

## Decision

`services/provider-registry.mjs` keeps an in-memory registry. `data/migrations/0008_provider_registry.sql` stores the same fields. The kind is one of the five task names. Product, channel, docs reference, region, status, and version are caller-supplied text. Limits and heartbeat are caller-supplied text or null. A number is rejected. Last error is text or null.

Create inserts the first version. Update inserts a new version and leaves the earlier row. Archive sets `archivedAt` on the lineage and does not delete rows. A later update of an archived lineage is rejected. An archived SQL row cannot be rewritten or cleared. Each service mutation appends one frozen audit row with `configChecksum: null` and `approval: null`. A denied actor writes no audit. Caller secret fields are not copied. Decision 0021 stores secret-manager references on this registry. The registry does not open a connection and does not read live trading flags.

## Evidence

`pnpm test:provider-registry` covers denied roles, one record for each kind, a new version after update, archive without deleting history, frozen audit rows, and text limits and heartbeat.
