# 0034 — Read-only Spot depth view

Status: accepted for the bounded Spot depth view.

## Context

TASK 08.B.02 asks for bounded depth levels, BBO, spread, imbalance, and a validity timestamp as read-only values. Last trade price must not stand in for executable depth. A stale book must not produce an executable fill assumption.

Design page 7 names the order book as an L2 snapshot plus incremental updates, with top 10, 25, and 50 levels configurable. The same page names spread and depth imbalance beside that book, and names BBO as best bid and ask. Design page 8 defines OBI as `(bid depth − ask depth) / (bid depth + ask depth)`. It names no rounding scale. The documented depth snapshot has `lastUpdateId`, bids, and asks, and no timestamp. A diff-depth event carries event time `E`. Decision 0033 keeps the Spot book. The official trade example price is not a book level.

## Decision

`services/spot-depth-view.mjs` reads a book already published by `services/spot-book-sync.mjs`. The caller must choose bound 10, 25, or 50. Bids are ordered from the highest price and asks from the lowest. Each side is cut at that bound. Quantity totals and OBI use only those levels. Spread is the best ask price minus the best bid price, as a decimal string. A ratio that does not terminate stays a reduced fraction. The validity timestamp is the event time of the last applied depth update. The published book stays hidden when the sync is not healthy, and this view then returns `executable` false, empty levels, and null BBO, spread, and imbalance. An input that carries a last trade price is rejected. The module has no fill function and does not place an order. L2 payloads have no per-order time. A later absolute quantity replaces that price level. Decision 0035 records Uniswap v3 and Raydium CPMM pool events and does not use this Spot depth view.

## Evidence

`pnpm test:spot-depth-view` passed 3/3. The healthy view orders bids `0.0025` then `0.0024` and asks `0.0026` then `0.0027`, with totals `4` and `4`, spread `0.0001`, and imbalance `0`. A later update replaces the best bid quantity and sets imbalance `-1/7`. Bound 10 sums the best 10 of 12 bid levels. A stale stream returns no executable depth, and the trade price `0.001` is not accepted as a level. `pnpm test:spot-book-sync` passed 4/4. `pnpm test:spot-l2-sequence` passed 6/6. `pnpm health` stayed `liveTrading` `OFF` and `liveOrdersLocked` true.
