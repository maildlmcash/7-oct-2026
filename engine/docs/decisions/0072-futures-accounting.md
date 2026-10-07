# 0072 — Futures fills, funding, and fees

Status: accepted for versioned futures paper accounting. Position value, fees, funding, and PnL reconcile in contract units. Live orders stay locked.

## Context

TASK 15.B.01 asks to simulate futures partial fills, fees, funding payments, and mark-to-market according to contract units, and to keep the assumptions versioned. Independent accounting fixtures must reconcile position value, fees, funding, and PnL.

Design page 7 says a paper fill walks available depth, records the fee, and appends immutable fill and funding records. A changed simulator does not overwrite a past fill. Design page 8 names the contract multiplier and the funding clock. It does not write a fee tier, a funding-payment formula, or a mark-to-market formula. Decision 0052 converts linear PnL as `side * (exit - entry) * quantity * multiplier` and inverse PnL as `side * quantity * multiplier * (1/entry - 1/exit)`. It applies no fee and no funding payment. Decision 0070 keeps that PnL and does not apply a fee or a funding payment.

## Decision

`services/futures-accounting.mjs` exports `createFuturesAccountingStore`, `postFuturesAccounting`, `readFuturesAccounting`, `FUTURES_ACCOUNTING_VERSION`, `FUTURES_ACCOUNTING_ASSUMPTIONS`, `FUTURES_ACCOUNTING_PNL`, `FUTURES_FILL_FEE`, `FUTURES_FILL_NOTIONAL_LINEAR`, and `FUTURES_FILL_NOTIONAL_INVERSE`.

The assumptions version is `contract-units`. Any other version is `assumptions version does not match` and is not stored. Reports cite that version and the frozen assumption list. A later event on the same account cannot change the version.

A long fill consumes asks from the lowest price. A short fill consumes bids from the highest price. Quantity the book cannot cover is a partial fill of the visible remainder. No visible quantity is `depth is not sufficient` and appends nothing. Each consumed price stays its own lot. Lots close first-in first-out. An average entry is not calculated.

Realized PnL and mark-to-market call `convertContractPnl`. The mark is the exit. Linear filled notional is `price * quantity * multiplier`. Inverse filled notional is `quantity * multiplier / price`. The fee is the caller rate times that notional. Explicit fee `0` stays `0`. A funding payment is the caller signed amount in the settlement currency. The contract funding interval is recorded and `fundingIntervalApplied` stays false. The account PnL is realized PnL plus position value plus funding minus fees. Comparison is exact because the source names no rounding scale.

The caller supplies an independent statement of position quantity, position value, fees, funding, and PnL. A match is reconciled. A mismatch stays visible, sets `alert` true and `promoted` false, and does not replace the derived figures. The same idempotency key and body replay the stored report and do not apply the fill twice. A Spot order is `product is not supported` and is not stored. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true. No PostgreSQL table was added. `contract-specs.mjs`, `futures-paper.mjs`, and `paper-fills.mjs` were not changed.

## Evidence

`pnpm test:futures-accounting` passed 3/3, duration_ms 301.137634. A linear long of quantity `5` against asks `3` at `100` and `1` at `110`, multiplier `1`, is a partial fill of `4` with unfilled `1`. The lots stay `3` at `100` and `1` at `110`. Mark `110` gives position value `30`, which matches `convertContractPnl`. Fee rate `0.001` gives fee `0.41`. PnL is `29.59`. Replaying the key leaves that report and does not make the quantity `8`. Funding `-0.1` leaves position value `30`, fees `0.41`, and PnL `29.49`. The first report stays PnL `29.59`. A short of quantity `2` at `110` realizes `20`, leaves lots `1` at `100` and `1` at `110`, position value `10`, fees `0.63`, funding `-0.1`, and PnL `29.27`. The funding interval stays `8` and is not applied. An inverse long of quantity `2` from `100` to `110` has position value `1/550`, fee `0.00002`, and PnL `989/550000`. An inverse dated long of quantity `1`, multiplier `10`, from `100` to `125` has position value `0.02`, fee `0.0001`, and PnL `0.0199`. Stated fees `9.001` against derived `0.2` stay visible, set `alert` true, and leave `promoted` false. Replaying that key leaves quantity `2`. A Spot object `fixture-spot-order` is `product is not supported` and is not stored. `bearer fixture-token` is not echoed. Assumptions version `guessed-version` is not echoed. Price `100.2` is `price is not on the tick` and is not echoed. A Customer writes no report. The module calls `convertContractPnl` and does not call the Spot depth view or a venue client. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Fee `0.001`, funding `-0.1`, and funding interval `8` are fixtures and are NOT IN SOURCE. Decision 0073 records liquidation and reduce-only cases and does not change this accounting.
