# 0024 — Provider config review

Status: accepted for reviewed provider changes and rollback.

## Context

TASK 06.C.01 asks for review and audit when an endpoint, channel, scope, or limit changes. The last known good version must stay visible, and a rollback must restore a selected version without losing the audit trail.

Decision 0020 versions provider rows and audits each mutation. The stored endpoint reference is `docsReference`. Channel and limits are their own fields. Scope is the market-data and order credential configuration from decision 0021. Design section 3 names maker-checker approval. The source names no checksum algorithm and no second role name. The shell has no provider screen.

## Decision

A create is the baseline and is the last known good version. An update that changes `docsReference`, `channel`, `limits`, or the market-data or order credential scope stays pending. The previous known-good version remains current for reads. The maker cannot approve that pending version. A different same-tenant Admin can approve it. The approval audit is appended. The earlier audit row is not changed.

A heartbeat-only update does not wait for that review. Rollback copies a selected known-good version into a new version and audits the restore. Pending versions cannot be selected. Older rows and older audit rows stay in place. `configChecksum` stays null. `displayProviderReview` shows the last known good version, endpoint, channel, scope, limits, and any pending version. The module does not open a connection and does not read live trading flags. Decision 0025 records the official documentation review on this registry.

`data/migrations/0012_provider_review.sql` stores approve and rollback rows and rejects update or delete.

## Evidence

`pnpm test:provider-registry` covers a pending channel change, a rejected maker approval, a second Admin approval, pending endpoint, limit, and scope changes, a rollback to the first version, and the unchanged first audit row.
