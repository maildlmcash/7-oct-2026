# 0025 — Provider documentation review

Status: accepted for recorded documentation reviews.

## Context

TASK 06.C.02 asks every enabled provider to record an official documentation URL, a checked-at date, supported products, and a verification owner. A stale documentation review must not display as verified.

Decision 0020 stores `docsReference` as the endpoint reference. Decision 0024 reviews changes to that reference. The source names no staleness duration and no closed product list. The shell has no provider screen.

## Decision

`recordProviderDocumentation` appends one review for a provider lineage. An enabled review requires an `http` or `https` documentation URL with no user information or secret query key, a parseable checked-at time, at least one supported product string, and a verification owner. A disabled provider can be stored without those fields. Its display stays `unverified`.

`stale` is the caller-supplied flag. The service does not calculate it from checked-at, because the source names no review age. `displayProviderDocumentation` shows the latest review. The state is `verified` only when the latest review is enabled, complete, and not stale. A stale review displays `stale`. The module does not open the URL and does not read live trading flags.

`data/migrations/0013_provider_documentation.sql` stores the same fields. An enabled row without a URL and checked-at time is rejected. Rows cannot be updated or deleted.

## Evidence

`pnpm test:provider-registry` covers a missing checked-at time, a URL with user information, a verified enabled review, a later stale review whose display is not verified, and a disabled provider that stays unverified.
