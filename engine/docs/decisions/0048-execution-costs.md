# 0048 — Executable fees, spread, and slippage

Status: accepted for round-trip cost assumptions walked from visible depth. No order is placed. No prediction score is calculated.

## Context

TASK 11.A.02 asks for executable net return assumptions from fees, spread, depth-aware slippage, and impact. A fill must not be estimated from last price alone. Fixtures must reconcile known fee and depth examples. An uncertain cost yields no-trade or low confidence.

Design page 7 names an impact and slippage estimate from the top 10, 25, or 50 book levels. Design page 8 subtracts round-trip fees, spread, and slippage in the execution gate and names no fee rate and no safety-buffer number. Decision 0034 fixes the example book: bids `0.0025` then `0.0024`, asks `0.0026` then `0.0027`, quantities `3` and `1`, and spread `0.0001`. Decision 0034 also rejects last trade price as executable depth. Decision 0047 leaves label costs unapplied. The source names no numeric confidence scale.

## Decision

`services/execution-costs.mjs` exports `readExecutionCost`. The caller supplies the bid levels, the ask levels, the quantity, and a fee rate. Bids are consumed from the highest price and asks from the lowest price. The same price is aggregated before the walk. The buy average and the sell average are the quantity-weighted level prices. A quantity that the visible book cannot cover returns no average and does not keep a partial fill.

Spread is the best ask minus the best bid. Its return is that spread divided by the mid price, with mid equal to the best bid plus the best ask, divided by two. Slippage is the extra paid beyond the touch on both legs, divided by the same mid. Impact is the spread return plus the slippage return, which is the round-trip distance from the sell average to the buy average, divided by the mid. The fee return is twice the supplied fee rate. The net return is the negative of the fee return plus the impact return, so spread and slippage are not subtracted a second time. Comparison and division use scaled integers. A non-terminating ratio stays a reduced fraction.

A missing fee, a missing book, a crossed book, or insufficient depth is `no-trade` with confidence `low` and a null net return. `lastPrice` without a book is `last price is not a fill` and the price is not copied. `lastPrice` beside a book does not change the averages. Confidence is `low` or null. There is no numeric confidence. Fee rate `0.001` is a caller fixture. The label version still does not apply these costs. The module does not calculate `S_spot` and does not place an order. No PostgreSQL table was added. Decision 0049 records the signed Spot baseline score and does not change these costs.

## Evidence

`pnpm test:execution-costs` passed 3/3, duration_ms 526.471982. Quantity `4` on the decision 0034 book, with fee rate `0.001`, returns spread `0.0001`, buy average `0.002625`, sell average `0.002475`, fee return `0.002`, spread return `2/51`, slippage return `1/51`, impact return `1/17`, and net return `-517/8500`. The same call with last price `0.001` matches and does not copy that price. Quantity `3` stays on the touch: slippage `0`, impact `2/51`, and net return `-1051/25500`. An explicit fee `0` leaves fee return `0` and net return `-2/51`. Quantity `5` is `depth is not sufficient`, action `no-trade`, confidence `low`, and it has no partial average. A last price alone is `last price is not a fill`. A missing fee and a crossed book are `no-trade` with confidence `low`. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
