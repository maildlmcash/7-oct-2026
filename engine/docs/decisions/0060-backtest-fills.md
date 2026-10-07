# 0060 — Backtest fill accounting

Status: accepted for fee, spread, and depth-slippage costs from the existing execution-cost function. Unsupported partial fills, funding, and cancellations stay explicit. No order is placed.

## Context

TASK 13.B.01 asks for depth-aware fills, fee schedules, spread and slippage, partial fills, funding, and cancellations where the data supports them. Unsupported assumptions must be marked prominently.

Decision 0048 walks a quantity through the visible book. A book that cannot cover the quantity is not a partial fill. `lastPrice` is not a fill. The source names no fee tier and no funding-interval conversion. Decision 0059 records datasets and does not price a fill.

## Decision

`services/backtest-fills.mjs` exports `simulateBacktestFill`. It calls `readExecutionCost` for the book, the fee rate, and the quantity that the book must cover. The returned net, spread, fee, and slippage are that function's values. `orderSubmitted` stays false.

A partial fill is recorded only when the caller supplies a filled quantity that is positive and no greater than the order quantity, and the book covers that filled quantity. The unfilled remainder is the order quantity minus that filled quantity. When the book cannot cover the quantity, the result is `depth is not sufficient`, action `no-trade`, and the assumption `partial fill is not supported when depth cannot cover the quantity`. No partial quantity is invented.

Omitted funding adds the assumption `funding is NOT IN SOURCE`. A supplied funding decimal is recorded and is not converted from an interval. Omitted cancellation adds `cancellation is not configured`. `cancelled` true records action `cancelled`, applies no cost, and submits no order. `lastPrice` without a book remains `last price is not a fill` and is not echoed.

## Evidence

`pnpm test:backtest-fills` passed 3/3, duration_ms 159.960097. Order quantity `4` reconciles to net `-517/8500`: its fee, spread return, and slippage return are the `readExecutionCost` values and sum to the absolute net. Order quantity `3` reconciles separately to net `-1051/25500`. The two nets are not copied onto each other. A filled quantity `3` against order quantity `4` is partial, unfilled `1`, funding `0.01`, and uses the quantity `3` net. Quantity `5` with filled quantity `5`, and an empty book, stay `costsApplied` false with a null net and a null filled quantity. `lastPrice` `0.001` is not echoed. A cancellation with funding `0` keeps that zero, applies no cost, and leaves `orderSubmitted` false. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Fee `0.001` and funding `0.01` are fixtures and are NOT IN SOURCE. Decision 0061 records the performance report and does not change these fills.
