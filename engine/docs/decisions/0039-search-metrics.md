# 0039 — Search load-fixture metrics

Status: accepted for the in-memory load-fixture report.

## Context

TASK 09.C.01 asks to track query latency, errors, freshness, queue lag, index size, and rejected documents. Initial targets are measured internal SLOs. They are not universal guarantees. A load-fixture report must include p50, p95, p99, and the error rate. Alert thresholds must be configurable.

Design section 18 names p50, p95, and p99 among the benchmark fields. It names no numeric target, no latency unit, and no percentile ranking rule. TASK 09.B.01 and TASK 09.B.02 remain BLOCKED. No OpenSearch process and no `services/search-indexer/` directory are in this repository, so there is no cluster latency, byte size, or search-queue lag to read. `services/search-documents.mjs` is the in-memory document store. `apps/web/health.mjs` stays the frozen paper-mode health JSON. The market-event queue is a separate backbone and is not a search queue.

## Decision

`services/search-metrics.mjs` records caller-supplied query samples and gauges. A report requires at least one sample and a measured freshness, queue lag, and index size. Missing samples fail closed with `load fixture is required`. A missing gauge fails closed with `<name> is not measured`. The source names no latency unit, so the integer is stored as supplied.

Percentiles use nearest rank, `ceil(p * n / 100)`, because the source names p50, p95, and p99 and names no ranking rule. The error rate is the reduced fraction of failed samples over all samples. Rejected documents are a counter incremented by `recordRejection`. Index size is the caller-supplied document count. A rejected credential is not copied into the report.

Thresholds are optional and caller-supplied. An omitted threshold stays `configured` false and value null. No default SLO number is stored. An alert is recorded only when the measured value is greater than the configured threshold. The same samples can be reported against another threshold set. `universalGuarantees` is false. The module does not open OpenSearch, does not change search authorization, and does not place an order. Decision 0040 records the search recovery drill and runbook and does not change these metrics.

## Evidence

`pnpm test:search-metrics` passed 4/4, duration_ms 173.153527. The load fixture latencies 10 through 100 produce p50 50, p95 100, p99 100, and error rate `1/5`. A tighter caller threshold raises alerts. An equal caller threshold raises none, and the measured p99 stays 100. A report with no samples returns `load fixture is required` and no measured percentiles. A password rejection from `indexSearchDocument` is counted as one rejected document, the stored index size stays 0, and the report text does not contain the password or the private-key block. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
