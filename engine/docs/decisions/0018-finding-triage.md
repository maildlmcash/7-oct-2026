# 0018 — Finding triage

Status: accepted for the in-memory finding log.

## Context

TASK 05.C.01 asks a finding to carry an owner, status, severity, due date, linked checklist item, and remediation evidence. Resolving the finding must leave the raw evidence unchanged. A status transition needs an authorized actor and evidence. Admin and user visibility must differ.

The `finding` table already has `owner`, `status`, and `checklist_item_id`. Checklist status is `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, or `NOT_APPLICABLE`. Same-tenant Admin is the only checklist editor. Same-tenant Customer is the user-facing reader. Other roles are denied. The source names no severity scale and no due-date duration. Decision 0016 left severity null. The diagnostic bundle from 0017 is the raw evidence.

## Decision

`services/finding-triage.mjs` updates one finding already in the log. Only a same-tenant Admin can change it. A status change requires a remediation evidence URL and appends that URL. It does not replace older remediation URLs. `PASS` and `NOT_APPLICABLE` also require a linked checklist item. Those two statuses are the existing resolved set. Owner text uses the checklist rule: blank is rejected, and a reader sees `UNKNOWN` when no owner is stored. A due date is the caller-supplied time string, or null. Severity stays null. A caller-supplied severity is not stored.

The raw bundle object is copied by reference. A resolve call cannot replace it. A later occurrence keeps the owner, due date, checklist item, remediation list, and bundle. Admin view includes the bundle and `canEdit: true`. Customer view omits the bundle and has `canEdit: false`. Both see status, owner, severity, due date, checklist item, and remediation evidence. The service does not write the `finding` table and does not read live trading flags.

## Evidence

`pnpm test:finding-triage` covers a denied customer, Super Admin, and cross-tenant Admin, a missing evidence URL, a resolve that keeps the bundle, and the Admin and Customer views.
