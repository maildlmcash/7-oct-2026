# 0023 — Provider health and limits

Status: accepted for recorded health observations.

## Context

TASK 06.B.02 asks each endpoint to record rate-limit headers, connection status, heartbeat age, retry budget, and backoff state. Documented exchange limits and a configured safety margin must be respected. A mock 429 and a mock disconnect must show bounded backoff and a visible degraded status, without a retry storm.

Decision 0020 stores provider limits and heartbeat as text because the source names no numeric limit or interval. Decision 0022 records manual actions and does not open a connection. The source names no retry budget, no safety-margin formula, and no heartbeat age. The shell has no provider screen.

## Decision

`recordProviderHealth` appends one observation for a provider lineage. Rate-limit headers are the caller-supplied text pairs. Secret-named headers and secret values are dropped. Heartbeat age is the caller-supplied measurement, stored as text, and it is not compared with an interval. Connection status is the caller-supplied text.

A retry runs only when the caller supplies a whole-number documented limit, safety margin, and retry budget, and the observed use plus the margin does not exceed the documented limit. The source names no formula, so that comparison is the margin check. Missing numbers stop retries. A 429 or a connection status of `disconnected` sets status `degraded`. Attempts stop at the caller budget. The backoff state is `bounded` when the budget is used and `stopped` when retries are refused. A requested retry count above the budget is ignored. The provider row status is not changed. The module does not open a connection and does not read live trading flags. Decision 0024 reviews endpoint, channel, scope, and limit changes on this registry.

`displayProviderHealth` shows the latest observation, including `degraded`. `data/migrations/0011_provider_health.sql` stores the same fields and rejects an attempt count above the budget.

## Evidence

`pnpm test:provider-registry` covers a 429 that stops at the caller budget, a second 429 that does not grow past that budget, a margin that stops retries, a disconnect on another endpoint, a dropped authorization header, and the degraded display line.
