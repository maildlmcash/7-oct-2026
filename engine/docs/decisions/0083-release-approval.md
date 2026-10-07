# 0083 — Final human release checklist

Status: accepted for an in-memory release checklist. The release stays BLOCKED until each required area has its own approver and evidence. A live release stays BLOCKED after those approvals because live orders stay locked. The audit bundle is exportable in both states. This module does not deploy.

## Context

TASK 18.C.02 asks for a signed release checklist covering security, data quality, model, operations, business-policy, and live-trading approvals where applicable. A system-generated PASS must not replace an approver. The release stays BLOCKED until the required evidence and independent approvals exist, and the final audit bundle must be exportable.

Design phase 11 asks for an evidence pack, a risk sign-off, and distinct approvals, and otherwise says WAIT_EXTERNAL. This task's acceptance word is BLOCKED, so the module uses BLOCKED and does not emit WAIT_EXTERNAL. Design page 2 keeps live order paths locked until separate approval. Decision 0075 copies the live flags from frozen health and does not treat a passed gate as live mode. Decision 0082 records rollout and does not collect human approvals. The source names no signature image. A 28-day paper count and a 200-outcome count are not stored as gates here, because this checklist has no measured sample to attach.

## Decision

`services/release-approval.mjs` exports `RELEASE_APPROVAL_AREAS`, `RELEASE_APPROVAL_LIMITATIONS`, `createReleaseChecklist`, `openReleaseChecklist`, `recordReleaseApproval`, and `exportReleaseBundle`.

A paper checklist requires security, data quality, model, operations, and business-policy. A live checklist also requires live-trading. Each area needs a same-tenant Admin other than the maker, and an evidence reference. Approver ids cannot repeat. The maker is `maker cannot approve`. A second approver for an area is `approval is already recorded`. A `status` or `generated` field is `system pass is not an approver` and is not stored. A paper-day count is `paper day count is NOT IN SOURCE`. An outcome count is `outcome count is NOT IN SOURCE`.

Until an area is missing, the result is `blocked` and `blocked` is `BLOCKED`. The export still returns the bundle, including empty approver fields and a SHA-256 checksum. SHA-256 is the existing audit checksum choice. When the five paper approvals are present, the paper result is `approved` and `blocked` is null. That result is the record of those approvers. It is not a generated PASS, and `deployed` stays false. A completed live checklist stays `BLOCKED` with `live orders are locked`. `liveTrading` stays `OFF`, `liveOrdersLocked` stays true, and `liveEnabled` stays false. Live-trading on a paper checklist is `approval area is not applicable` and is not stored. Each open and each new approval appends one frozen audit row with actor, action, target, reason, before, after, approval, changedAt, and checksum. Rows are not rewritten. Same-tenant Admin is the only actor. No PostgreSQL table was added. `apps/web/health.mjs`, `services/release-gate.mjs`, and `services/release-rollout.mjs` were not changed.

## Evidence

`pnpm test:release-approval` passed 3/3, duration_ms 293.488832. An opened paper checklist exports `blocked` `BLOCKED` with reason `security approval is not recorded`. The live-trading row is not applicable. A second export keeps the same checksum and does not add an audit. Status `PASS` is `system pass is not an approver` and stores nothing. `paperDays` `28` is `paper day count is NOT IN SOURCE` and stores nothing. The maker cannot approve security. A second area from `fixture-security` is `approvers are not distinct`, and the security row stays at index 0.

Five distinct approvers, `fixture-security` through `fixture-business`, make the paper result `approved` with `blocked` null. `liveTrading` stays `OFF`, `liveOrdersLocked` stays true, `liveEnabled` stays false, and `deployed` stays false. The bundle has no PASS value. Replaying the security approval does not add a row. A live checklist with those five approvals is `live-trading approval is not recorded`. After `fixture-live` approves that area, the result stays `blocked` with `live orders are locked`. The exported live row names `fixture-live`. These ids and evidence strings are fixtures.

A Customer and a cross-tenant Admin write nothing. `bearer fixture-token` is not stored. `apiKey` is `live credentials are not allowed` and is not stored. `outcomeCount` `200` is `outcome count is NOT IN SOURCE`. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. A signature image, a measured 28-day count, and a measured 200-outcome count are not in this module.
