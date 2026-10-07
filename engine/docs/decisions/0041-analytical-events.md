# 0041 — Analytical events and retention

Status: accepted for the in-memory analytical store. ClickHouse is not running.

## Context

TASK 10.A.01 asks to store normalized analytical events on the selected ClickHouse/Parquet path with retention, partitioning, schema version, and access controls. PostgreSQL stays the transactional store. Retention and partition tests must pass. Storage estimates and deletion behavior must be documented.

Design section 18 selects ClickHouse plus immutable Parquet/object storage for high-volume trades, features, and replay. It keeps users, checklist, permissions, configs, orders, the commission ledger, and audit in PostgreSQL, and it says PostgreSQL is not the tick store. Design page 48 links to `https://clickhouse.com/use-cases/real-time-analytics` and says the version is locked from the official docs on the day it is used. No version, host, bucket, table, partition key, or retention period is named. Decision 0028 is the normalized public envelope. Decision 0031 records that the source names no retention period and no deletion rule. No ClickHouse process, Parquet library, or `services/features/` directory is present.

## Decision

`services/analytical-events.mjs` stores frozen copies of normalized envelopes in memory. The recorded path is `ClickHouse + immutable Parquet/object storage`. The module does not open ClickHouse, write a Parquet file, or insert a PostgreSQL row. Each row keeps the caller partition text, the tenant id, and the envelope schema version. The source names no partition key, so a missing partition stores nothing and returns `partition is not configured`.

A same-tenant Admin may write. A same-tenant Customer or Admin may read. Other roles and cross-tenant actors receive no rows. A client `granted` flag is rejected. A sensitive field or a raw order-book field is rejected and not stored.

Deletion is not automatic. `DELETION_BEHAVIOR.automatic` is false. The detail states that the source names no retention period and no deletion rule, and that string event times are not deleted. `applyAnalyticalRetention` without a positive integer period returns `retention period is not configured` and deletes nothing. A supplied period and clock are caller fixtures. They delete only same-tenant rows whose numeric event time is older than that clock minus that period. The storage estimate is the canonical JSON byte length of the rows visible to the actor. The note states that this is not a ClickHouse compression estimate. The module does not place an order. Decision 0042 calculates the source-backed market features and does not change this store.

## Evidence

`pnpm test:analytical-events` passed 3/3, duration_ms 316.949342. Two envelopes with schema version `fixture-1` and price `4.00000100` stay in separate caller partitions. A Customer reads the partition for that tenant. A tenant-b Admin and a Distributor receive no rows. A Customer write is `role scope denied`. A missing partition stores nothing. Three rows remain when retention is omitted. A caller period of 1000 at clock 4000 deletes the numeric event time 1000, keeps event time 5000, and keeps the string event time. The visible byte estimate falls, and a tenant-b estimate is 0 rows. No migration file contains `analytical_event`. A password and a bid field are rejected. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. `clickhouse` is not on `PATH`. `curl -sS -m 2 http://127.0.0.1:8123/ping` failed with `curl: (7) Failed to connect to 127.0.0.1 port 8123`.
