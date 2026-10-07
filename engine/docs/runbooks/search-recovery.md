# Search recovery

Owner: fixture-owner
Last tested: 2026-10-06

The owner name is a drill fixture. The source names no operator.

## Snapshot and restore

The drill copies the in-memory search index, including document ids, visibility revisions, and the next id. SHA-256 of the canonical JSON is the checksum. The source names no checksum algorithm, so SHA-256 is an implementation choice. Restore replaces a damaged index with that copy. The restored document count and checksum match the snapshot. A raw order-book field is rejected and is not stored.

## Alias rollback

No search alias is installed. services/search-indexer/ is absent, and OpenSearch is not running. rollbackSearchAlias returns blocked BLOCKED with error search alias is not installed. The refusal leaves the restored checksum unchanged.

## Partial outage

The drill removes one stored document and then restores the snapshot. The damaged count is lower. The restored count and checksum match the snapshot. A same-tenant Customer still sees only documents whose current visibility includes Customer. A same-tenant Admin sees the restored documents. A cross-tenant read stays empty.

## Degraded UI

Search remains one of the seven section buttons. The section navigation and the heading stay outside the section error boundary. A render failure shows Section render failed and replaces that panel body. A failed view-state request shows Section request failed and leaves the section content mounted. The other section buttons stay in place. Live trading stays OFF.
