# 0063 — Leakage review and report export

Status: accepted for an explicit checklist. A leaked sample is caught. The export names the reviewer and the evidence. No order is placed.

## Context

TASK 13.C.02 asks for a reviewer checklist for lookahead, survivorship, selection, and label leakage, and for an export of the reviewed result with limitations.

Design page 8 says a feature value comes only from data up to the decision time, and that overlapping windows and look-ahead leakage stop. The label is the future mid-price return. Decision 0046 already names the lookahead-window check. Decision 0062 stores the run and does not review leakage.

The source names no survivorship threshold, no selection criterion, and no leakage score. The experiment record has no tenant.

## Decision

`services/leakage-review.mjs` exports `LEAKAGE_CHECKLIST`, `LEAKAGE_LIMITATIONS`, and `exportLeakageReview`. The checklist order is lookahead, survivorship, selection, and label leakage. The caller does not supply the checklist result.

Lookahead calls `checkFeatureQuality`. A feature time after the label outcome is `lookahead window` and names the feature and source. A feature time after the decision and at or before the label outcome is `label leakage`. A label outcome that is not after the decision is `label leakage`. A non-survivor missing from the sample is `survivorship`. A candidate missing from the sample, or a sample row that is not a candidate, is `selection`. A missing non-survivor is not also counted as selection.

The reviewer is an Admin `{ id, role, tenantId }`. Any other role is `role scope denied`. Evidence is a filled string. A secret is `secret value is not allowed` and is not echoed. The export copies the resolved run's code SHA, model version, data version, feature version, config checksum, and output checksum. `seedUsed` stays false. The submitted sample rows stay listed when a leak is caught. The export keeps four limitations: the survivorship threshold, the selection criterion, and a leakage score are `NOT IN SOURCE`, and the experiment tenant is `NOT IN SOURCE`.

A missing reviewer, missing evidence, or an unresolved run exports nothing. A caught leak still exports the reviewer, the evidence, the checklist, and the limitations. No PostgreSQL table was added. The module does not place an order.

## Evidence

`pnpm test:leakage-review` passed 3/3, duration_ms 461.389131. A clean review names reviewer `fixture-reviewer`, evidence `fixture-evidence`, and the four limitations. It resolves code SHA `a67aca9027167448f60de9abebca9e94cf43d325`, model `fixture-model`, data `fixture-data`, and features `fixture-features`. `seedUsed` is false. The output checksum is the SHA-256 of the fixture text `fixture-output`. Changing the caller's reviewer after the export leaves the stored reviewer in place. A feature at time `1499865549593` against label outcome `1499865549592` is caught as `lookahead window` on feature `spread` and source `fixture-source`, and the row stays in the export. Universe member `fixture-dropped` with `survived` false is `survivorship`. Candidate `fixture-omitted` is `selection`. A feature at `1499865549591` inside outcome `1499865549592` is `label leakage` and the export does not say `lookahead window`. A label outcome equal to the decision is `label leakage` with a null feature. A late receive stays `late event` and does not mark the four checklist items caught. A missing reviewer, a Customer, and evidence `bearer fixture-token` export nothing; the token is not echoed. A supplied checklist token `fixture-clear` is `unsupported field` and is not echoed. A missing run does not echo the code SHA. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The lag threshold `1000`, the label offsets, the run id, and the reviewer are fixtures and are NOT IN SOURCE. Decision 0064 records the paper order lifecycle and does not change this review.
