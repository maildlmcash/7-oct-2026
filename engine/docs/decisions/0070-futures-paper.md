# 0070 — Futures paper orders and positions

Status: accepted for a separate futures paper-order and position model. Linear and inverse PnL stay the contract conversions. A Spot order is rejected. Live orders stay locked.

## Context

TASK 15.A.01 asks for a futures paper-order and position model that handles contract multiplier, direction, reduce-only, position mode, and margin mode. Unit and PnL tests must cover linear and inverse contracts. A Spot order object must not be accepted.

Design page 8 says perpetual and dated futures, and linear and inverse contracts, are modeled with separate multipliers and PnL. It also names isolated and cross margin, one-way and hedge position mode, and reduce-only. It does not write the position-quantity algebra, a leverage ceiling, or a liquidation price. Decision 0052 converts linear PnL as `side * (exit - entry) * quantity * multiplier` and inverse PnL as `side * quantity * multiplier * (1/entry - 1/exit)`. It applies no fee and no funding payment. Decision 0064 accepts only product `spot`.

## Decision

`services/futures-paper.mjs` exports `createFuturesPaperStore`, `appendFuturesPaperOrder`, `readFuturesPaperPosition`, `FUTURES_PRODUCT`, `FUTURES_MARGIN_MODES`, and `FUTURES_PAPER_LIMITATIONS`.

The product is `futures`. A input with product `spot`, or a Spot lifecycle object that carries `state`, is `product is not supported` and is not stored. The Spot paper-order function still rejects product `futures`. The multiplier is the registered contract multiplier. The caller cannot supply a different one. PnL is `convertContractPnl`. An open order does not record a PnL. A close records the PnL of the closed quantity only.

Direction is `long` or `short`. Position mode is `hedge` or `one-way`. Margin mode is `isolated` or `cross`. Hedge keeps a long bucket and a short bucket. One-way keeps one side. Reduce-only decreases that side and never opens a side. A reduce-only order with no quantity on that side is `reduce-only has no position` or `reduce-only side does not match`, and it appends nothing. A reduce-only quantity larger than the open quantity is rejected and the position stays unchanged. An increase at a different entry price is `entry price is already recorded`. The source names no average of two entry prices. A one-way order in the opposite direction, with reduce-only off, closes the open side first and can leave the remainder as the new side. While a side is open, a different position mode or margin mode is rejected. The same idempotency key and body return the stored order and do not apply the quantity twice.

Leverage, maintenance margin, liquidation price, a funding payment, and a fee stay NOT IN SOURCE. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true. No PostgreSQL table was added. `contract-specs.mjs` and `paper-orders.mjs` were not changed.

## Evidence

`pnpm test:futures-paper` passed 3/3, duration_ms 778.984897. A one-way linear long of quantity `2` at `100`, multiplier `1`, closes in two reduce-only orders at `110`. Each order PnL is `10`. The position realized PnL is `20`, then the long bucket is empty. That `10` matches `convertContractPnl`. Replaying the open key leaves one order and does not make the quantity `4`. An inverse long of quantity `2` from `100` to `110` is `1/550`. The inverse short is `-1/550`. A linear dated short with multiplier `0.01` is `-0.2`. An inverse dated long of quantity `1` from `100` to `125`, multiplier `10`, is `0.02`. Hedge holds long `2` and short `2`. Reducing the long leaves the short at `2` and PnL `20`. A one-way short of `3` at `110` against a long of `2` closes `2` for PnL `20` and leaves a short of `1` at `110`. Reduce-only on the opposite side, a larger reduce-only quantity, a different entry `111`, a different position mode, and a different margin mode append nothing. A Spot object `fixture-spot-order` is `product is not supported` and is not stored. `appendPaperOrder` still rejects product `futures` and does not store `fixture-futures-order`. A Customer is `role scope denied`. Evidence text `bearer fixture-token` is not echoed. Price `100.2` is `price is not on the tick` and is not echoed. The module calls `convertContractPnl` and does not call `appendPaperOrder` or a venue client. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Funding interval `8` is a fixture and is NOT IN SOURCE. Decision 0071 records the futures pre-trade checks and does not change these positions.
