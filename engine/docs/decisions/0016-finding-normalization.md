# 0016 — Finding normalization

Status: accepted for the in-memory finding log.

## Context

TASK 05.B.01 asks signals to map into one finding schema: fingerprint, severity, first seen, last seen, affected build, route, platform, and status. Repeating an identical failure updates that finding and its occurrence count. The occurrence history stays. A distinct root signal stays a separate finding.

The checklist migration already stores `dedupe_fingerprint`, `first_seen`, `last_seen`, `seen_count`, and `status` on `finding`. It does not store severity, route, platform, or an occurrence list. Page-health events and layout faults are the signals already produced. The source names no finding severity scale. Design section 19's `services/normalizer` path is not this repository.

## Decision

`services/finding-normalizer.mjs` records one signal at a time. A page-health signal uses the closed page-health event. A layout signal uses one layout finding. The fingerprint is a stable JSON array of the root fields. Request id, build, and seen time are occurrence fields, so a new request id does not open a new finding.

The same fingerprint updates one finding. `firstSeen` is the earliest occurrence, `lastSeen` is the latest, and `occurrenceCount` is the history length. Earlier occurrence objects stay on the finding. `affectedBuild` is the latest build that passes the page-health hex rule. Any other build value, including a password, is null. `severity` stays null. Status stays `FAIL`, the existing checklist failure status. Platform is `API` for an `/api/` route, `website` for the other page-health routes, or the layout surface `website`, `mobile iOS`, or `mobile Android`. A combined `mobile` surface is rejected. A route outside the page-health set is null and is not copied into the fingerprint.

The service does not insert into the `finding` table and does not read live trading flags.

## Evidence

`pnpm test:finding-normalizer` covers a repeated page-health failure, separate status, route, and platform signals, and a repeated layout overlap whose box order does not split the finding.
