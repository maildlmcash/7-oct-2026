# 0079 — Commission calculation from approved snapshots

Status: accepted for net-fee calculation from an immutable approved rate snapshot. A remainder is not rounded. The lineage total cannot exceed the tightest ancestor rate cap. This module does not append a ledger entry.

## Context

TASK 17.B.02 asks for commission from an approved net-fee basis and an immutable rate snapshot. Commission must not default to notional or unrealized PnL. The calculation must enforce the cumulative ancestor cap. Golden fixtures must cover fees, refunds, exclusions, rounding, and the ancestor cap.

Design section 12 stores rates in basis points and says a child cannot exceed a parent ceiling. It names no rounding mode. It forbids commission on unrealized gains, deposits, notional volume, paper profit, and rejected or cancelled orders. It also forbids self-referral. Decision 0078 records the plan and does not calculate an amount.

## Decision

`services/commission-calculation.mjs` exports `calculateCommission` and `COMMISSION_CALCULATION_LIMITATIONS`.

The numeric basis is fee minus refund minus the exclusion amounts. A missing fee stays `fee is not configured`. A present `notional`, `unrealizedPnl`, `paperPnl`, `deposits`, or `pnl` field is `basis is not approved` and is not used as the fee. A negative net fee is `net fee is not positive`. A zero net fee calculates to zero. The rate, cap, basis, currency, and effective window are copied from the approved plan that covers the event time. A later plan version does not change an earlier result. A pending plan is `plan is not in effect`.

The amount is the net fee times the snapshotted rate, divided by 10000, in scaled integers. The quotient keeps every decimal place the division produces. `0.0001` stays `0.0001`. A caller rounding instruction is `rounding is not configured` and produces no amount. `Math.round` is not used.

The lineage is the event tenant's approved plan plus every approved ancestor plan with the same product, action, and eligible role whose window covers the event. Their rates are added. The ancestor cap is the smallest rate cap on that lineage. A larger total is `ancestor cap exceeded`, and no commission amount is returned. A child tenant with no covering ancestor plan is `ceiling is not configured`.

`rejected` and `cancelled` are `order is excluded`. Any other status except `settled` is `order is not settled`. The same customer and beneficiary is `self-referral is not allowed`. Super Admin and Admin may calculate inside tenant scope. Distributor, Retailer, Customer, and Super Distributor are `role scope denied`. The call does not push a ledger row, does not change a stored plan, and does not suppress a duplicate event. `liveTrading` stays `OFF` and `liveOrdersLocked` stays true. No PostgreSQL table was added. `services/commission-plans.mjs` was not changed.

## Evidence

`pnpm test:commission-calculation` passed 3/3, duration_ms 167.36175. Fee `10000`, refund `0`, and no exclusion at rate `1000` give net fee `10000` and amount `1000`. Refund `2500` gives net fee `7500` and amount `750`. Exclusion `1000` gives net fee `9000` and amount `900`. Refund `2500` and exclusion `1000` give net fee `6500` and amount `650`. Fee `100` and refund `100` give amount `0`. Fee `100` and refund `150` are `net fee is not positive`. Rate `1` on fee `1` gives `0.0001`. Rate `1` on fee `0.5` gives `0.00005`. Rounding `half-up` is `rounding is not configured` and the amount stays null. `fixture-notional`, `fixture-unrealized`, and `fixture-paper` are `basis is not approved` and are not stored. A missing fee beside a notional value is not converted into commission.

Rates `1000` and `2000` under cap `2500` return `ancestor cap exceeded` with cumulative rate `3000`, ancestor cap `2500`, and amount null. Rates `500` and `1000` under cap `4000` return amount `500`, ancestor amount `1000`, cumulative amount `1500`, and cap amount `4000`. A later root plan at rate `800` does not change the earlier snapshot, which stays `500`. The later event itself returns `800`. These rates and fees are fixtures. A pending plan is `plan is not in effect`. `rejected` and `cancelled` are `order is excluded`. The same customer and beneficiary is `self-referral is not allowed`. Customer, Distributor, and an Admin in `tenant-b` calculate nothing. `bearer fixture-token` is not stored. The plan rate stays `1000`. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Rounding mode, duplicate-event suppression, commission reports, hold duration, and ledger entries are not in this module. Decision 0080 records append-only commission ledger entries and does not change this calculation.
