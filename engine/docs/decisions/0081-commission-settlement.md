# 0081 — Settlement reconciliation and role visibility

Status: accepted for distinct earned, pending, settled, reversed, and statement totals read from the append-only ledger. A matching caller statement reconciles. A mismatch stays visible and does not edit the ledger. Business and legal commission policy stays pending. This module does not pay out.

## Context

TASK 17.C.02 asks for settlement reconciliation, reports, an approval trail, and role-based visibility. Any business or legal commission policy stays configurable until formal approval. Reconciliation must balance a fixture ledger. An unauthorized role must not view or edit another subtree's ledger.

Design section 12 shows earned, pending, settled, reversed, and statement totals distinctly. Payout rails are outside this baseline. Distributor and Retailer may review their own network reports and may not view unrelated tenants. Customer commission is not a downstream grant. No role may delete ledger history. A high-water mark and a hold duration are not given as formulas. Decision 0080 appends ledger entries and does not report them.

## Decision

`services/commission-settlement.mjs` exports `readCommissionReport`, `reconcileCommissionLedger`, `defineCommissionPolicy`, and `COMMISSION_SETTLEMENT_LIMITATIONS`.

The report reads `store.entries`. It does not append, replace, or remove a row. An earning that is not reversed is settled. A hold that is not released and not reversed is pending. A released hold that is not reversed is settled. A refund or reversal classifies the original accrual as reversed. Release and correction rows must match one original line with the same amount, tenant, plan id, and plan version. The statement total is pending plus settled. Earned is pending plus settled plus reversed. The sums use scaled integers. A remainder is not rounded.

Reconciliation compares the caller earned, pending, settled, reversed, and statement values with those totals. A match sets `reconciled` true and `alert` false. A difference is `statement does not match`, `reconciled` false, and `alert` true. The derived totals stay. `promoted` stays false. A broken link or an unreadable amount is `ledger is not balanced`.

Super Admin, Admin, Distributor, Retailer, and Customer may read a tenant inside their subtree. A Customer sees only rows whose `customerId` is that customer, and only the approval trail for plans on those rows. Other readers see the plans and approval rows in the subtree. Super Distributor is `role scope denied`. Another subtree is `tenant is outside subtree` and returns no rows. Catalog grants stay empty. Appending a ledger row still follows decision 0080, so Distributor, Retailer, Customer, and an Admin outside the subtree do not add a row.

`defineCommissionPolicy` stores a caller policy id, time, and note with status `pending`. Any other status is `formal approval is not recorded` and is not stored. `policyApplied` stays false. The policy does not change a total. No PostgreSQL table was added. `services/commission-ledger.mjs`, `services/commission-calculation.mjs`, and `services/commission-plans.mjs` were not changed.

## Evidence

`pnpm test:commission-settlement` passed 3/3, duration_ms 233.893572. Five root accruals of `1000` report earned `5000`, pending `1000`, settled `2000`, reversed `2000`, and statement `3000`. The same stated figures reconcile, `alert` is false, and the ledger length stays 8. A second call does not append. Stated earned `9.001` is `statement does not match`, the derived earned stays `5000`, and the original row stays at index 0. A policy id `fixture-policy` stays `pending`. Status `fixture-approved` is `formal approval is not recorded`. An Admin cannot store a policy. After the policy, the totals stay `5000` and `3000`, and `policyApplied` stays false. A release with no hold is `ledger is not balanced` and the row is left in place. These amounts are fixtures.

An Admin reading `tenant-a` sees earned `2000` on `tenant-a` rows only. The trail includes approved plan `fixture-child` with approver `fixture-super-2` and pending plan `fixture-pending` with no approval. It does not include `fixture-root`. The Super Admin reading `tenant-root` sees earned `4000`, including both line tenants. Customer `fixture-customer-payee` sees earned `1000` and does not see `fixture-other-payee`. An Admin reading `tenant-b`, a Distributor reading `tenant-a`, and a Retailer reading `tenant-b` are `tenant is outside subtree` and receive no rows. Super Distributor is `role scope denied`. Distributor, Customer, and an Admin posting outside the subtree leave the ledger length unchanged.

`checklist.write` is `permission is not granted`. `bearer fixture-token` is not stored. A stated amount `fixture-notional` is `statement is not configured` and is not stored. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Payout rails, a high-water mark, hold duration, and formal policy approval are not in this module. Decision 0082 records staged rollout and rollback and does not change this settlement.
