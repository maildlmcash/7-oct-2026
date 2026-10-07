# 0073 — Liquidation and reduce-only cases

Status: accepted for paper liquidation and reduce-only cases. Unsafe cases stop with an explicit status. A reduce-only close cannot increase exposure. Live orders stay locked.

## Context

TASK 15.B.02 asks to test margin deterioration, a liquidation-distance warning, a reduce-only close, and position-mode mismatches in paper simulation. Fault tests must not increase exposure through reduce-only actions. Unsafe cases stop with an explicit status.

Design page 7 names a liquidation-risk proxy in paper results and says a stale price blocks a new automatic entry while reduce-only stays separate. Design page 8 names reduce-only compatibility, a liquidation buffer, and one-way or hedge position mode. It says to deny when a required risk field is missing. It does not write a liquidation price or a margin formula. Decision 0055 compares a caller liquidation distance with a caller floor and records the formula as `NOT IN SOURCE`. Decision 0070 rejects a position-mode mismatch and a reduce-only order that would open a side. Decision 0071 vetoes a distance below the floor before every paper order, including reduce-only. Decision 0072 does not apply liquidation or reduce-only.

## Decision

`services/futures-liquidation.mjs` exports `createFuturesLiquidationStore`, `runFuturesLiquidationCase`, `readFuturesLiquidationCase`, `FUTURES_LIQUIDATION_KINDS`, `FUTURES_LIQUIDATION_ASSUMPTIONS`, and `FUTURES_LIQUIDATION_LIMITATIONS`.

The caller supplies the current risk readings and the prior maintenance-margin buffer and prior liquidation distance. Margin deterioration means the current buffer is below its prior reading or below its floor. A liquidation-distance warning means the current distance is below its prior reading or below its floor. Equal readings are neither. Neither value is derived from mark, leverage, or price. The distance formula stays `NOT IN SOURCE`.

A margin-deterioration case or a liquidation-distance warning stops. Status is `margin deterioration` or `liquidation-distance warning`. The position quantity stays unchanged. A case that is not deteriorated, or not a warning, stops with `margin has not deteriorated` or `liquidation distance is not a warning` and also leaves the quantity unchanged.

A reduce-only close is the only case that can change quantity. It decreases an open matching side through `appendFuturesPaperOrder` and never opens a side. A warning may be present and the close still reduces. A reduce-only order on the other side, a quantity larger than the position, a flat position, or `reduceOnly` false stops with that explicit status and appends nothing. A position-mode mismatch stops with `position mode does not match` before any quantity change. A margin-mode mismatch stops with `margin mode does not match`.

No liquidation order is synthesized. `futures-pretrade.mjs` still vetoes these readings before its own simulation. This module does not call it. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true. No PostgreSQL table was added. `futures-paper.mjs`, `futures-risk.mjs`, `futures-pretrade.mjs`, and `futures-accounting.mjs` were not changed.

## Evidence

`pnpm test:futures-liquidation` passed 3/3, duration_ms 322.113363. A one-way long of quantity `2` at `100` stays quantity `2` when the buffer falls from `0.050` to `0.049`, including when the order is reduce-only. A buffer of `0.06` below a prior `0.08` and above floor `0.05` is also `margin deterioration`. An equal buffer is `margin has not deteriorated`. A reduce-only close of quantity `1` at `110` while the buffer is `0.049` returns PnL `10`, leaves quantity `1`, and keeps the warning. Replaying that key leaves quantity `1`. A short reduce-only order is `reduce-only side does not match`. Quantity `2` is `reduce-only quantity is larger than the position`. `reduceOnly` false is `reduce-only is not set`. Exposure stays `1`.

A distance equal to `0.2` is `liquidation distance is not a warning`. A distance of `0.25` below a prior `0.3` and above floor `0.2` is `liquidation-distance warning`, and quantity stays `2`. A distance of `0.199` is the same warning. A reduce-only close of quantity `2` at `110` then has PnL `20`, exposure `0`, and the warning. A later reduce-only order is `reduce-only has no position`. A hedge long `2` and short `2` reduced by `1` on the long, with both warnings active, leaves long `1` and short `2`. Exposure goes from `4` to `3`.

A hedge order against a one-way position is `position mode does not match` for both the mismatch case and a reduce-only close. Quantity stays `2`. The same mode is `position mode matches`. Cross margin against isolated is `margin mode does not match`. An empty position is `position is not open`. A Spot object `fixture-spot-order` is `product is not supported` and is not stored. `bearer fixture-token` is not echoed. Price `100.2` is `price is not on the tick` and is not echoed. A Customer writes no case. The module calls `readFuturesRisk` and `appendFuturesPaperOrder`. It does not call the pre-trade gate or a venue client. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Buffer, distance, and prior readings are fixtures and are NOT IN SOURCE. Decision 0074 records futures failure drills and does not change these cases.
