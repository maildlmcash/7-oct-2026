# 0080 — Append-only commission ledger entries

Status: accepted for append-only earning, hold, release, refund, and reversal entries. A duplicate idempotency key or a duplicate event and plan version does not pay twice. A correction appends a new entry and preserves the original. This module does not calculate a new rate and does not write a statement.

## Context

TASK 17.C.01 asks for each earning, hold, release, refund, and reversal to be an append-only ledger event with a unique idempotency key and a plan version. Duplicate events must not pay twice. Corrections use reversal entries and preserve the originals.

Design section 12 creates an immutable commission accrual from a qualifying settled event and links the plan version, beneficiary, tenant lineage, basis, rate, and amount. Pending, settled, and reversed or adjusted states use compensating entries. Settled history is not edited or deleted. Retries must not double count. Rate changes apply prospectively. No role can delete commission ledger history. Hold duration, a rounding mode, a statement total, and role-based visibility are not named for this task.

Decision 0079 calculates an amount from an approved snapshot and does not append a ledger row. `services/commission-plans.mjs` and `services/commission-calculation.mjs` stay unchanged.

## Decision

`services/commission-ledger.mjs` exports `appendLedgerEntry` and `COMMISSION_LEDGER_LIMITATIONS`.

The caller supplies `store.entries` as an array. The call does not create that array on a commission store, and `calculateCommission` still does not write it. An earning or a hold calls `calculateCommission`. The stored amount, rate, basis, currency, and effective window are copied from that approved snapshot. The plan version on each entry is the snapshot `planId` and `changedAt`. One post appends one frozen entry per lineage line. Those lines share the caller idempotency key.

A plan with `hold` true refuses kind `earning` as `hold is required`. A plan with `hold` false refuses kind `hold` as `hold is not configured`. A release requires an existing hold for that idempotency key and appends a new row with the hold amount and plan version. The hold row stays at the same index. A refund or reversal requires an existing earning or hold, a reason of `reversed` or `adjusted`, and appends one compensating row per original line. The compensating amount equals the original amount. A second refund or reversal for that original is `event is already recorded`.

The same idempotency key and the same business fields return `idempotentReplay` and do not append. The same key with different content is `idempotency key is already recorded`. A new key for an event and plan version that already has that kind is `event is already recorded`. A caller amount that differs from the stored amount is `amount does not match` and is not stored. A missing ledger array is `ledger is not configured`.

Super Admin and Admin may post inside tenant scope. Distributor, Retailer, Customer, and Super Distributor are `role scope denied`. Catalog grants stay empty. A pending plan, a rejected or cancelled order, a forbidden basis, a rounding instruction, or a secret appends nothing. `liveTrading` stays `OFF` and `liveOrdersLocked` stays true. No PostgreSQL table was added. Statement totals and role visibility are not in this module.

## Evidence

`pnpm test:commission-ledger` passed 3/3, duration_ms 196.686624. Fee `10000` at rate `1000` appends one earning with amount `1000`, plan `fixture-rate`, and changedAt `2026-10-07T00:00:00Z`. The same key returns `idempotentReplay` and the length stays 1. A second key for that event is `event is already recorded`. The same key with another event id is `idempotency key is already recorded`. These rates and fees are fixtures.

A hold plan refuses an immediate earning as `hold is required`. A hold entry then a release entry leaves the hold object at the same index with amount `1000` and the same plan version. A second release does not append. A child rate `500` and a root rate `1000` append two lines, amounts `500` and `1000`, with cumulative amount `1500`. Replaying that key does not append. Another key for that event does not append. Rates `2000` and `1000` under cap `2500` return `ancestor cap exceeded` and append nothing. A later plan at rate `800` does not change the first entry, which stays rate `1000` and amount `1000`. The later event itself returns `800`.

A reversal with reason `adjusted` appends a second row with amount `1000` and the original plan version. The original earning stays at index 0, stays kind `earning`, and stays frozen. A second reversal does not append. A refund with reason `reversed` likewise preserves its earning. Caller amount `9.001` is `amount does not match` and is not stored. A missing reason and reason `guessed-version` are `reason is not configured`. A hold reversal also leaves the hold row in place.

A pending plan is `plan is not in effect`. `cancelled` and `rejected` are `order is excluded`. `fixture-notional`, `fixture-unrealized`, and `fixture-paper` are `basis is not approved`. Rounding `half-up` is `rounding is not configured`. Customer, Distributor, Super Distributor, and an Admin in `tenant-b` append nothing. `checklist.write` is `permission is not granted`. Kind `payout` is `entry kind is not approved`. `bearer fixture-token` is `secret value is not allowed` and is not stored. A direct `calculateCommission` call still leaves the ledger length unchanged. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Hold duration, statement totals, and role visibility are not in this module. Decision 0081 records settlement reconciliation and role-based visibility and does not change these ledger entries.
