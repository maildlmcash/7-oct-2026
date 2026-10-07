# 0066 — Depth-aware paper fills

Status: accepted for a paper-only marketable fill against the Spot L2 view. An invalid or stale book produces no fill. `lastPrice` is not a depth substitute. Live orders stay locked.

## Context

TASK 14.B.01 asks to simulate marketable paper fills against valid L2 depth with spread, partial fills, fees, and latency assumptions. A fill must not use last price as depth.

Design page 7 names the L2 book and spread. Design page 8 names taker buy and taker sell. Design page 10 names a market or limit choice and names no limit rule. Design phase 10 names simulated fills and a latency comparison and names no latency number and no queue position. Decision 0034 reads the bounded Spot book and does not fill. A view that is not executable has empty levels. Decision 0048 walks a round trip and does not keep a partial average when the book cannot cover the quantity. Decision 0064 names `partial fill` and `fill` as paper states and does not store a fill quantity.

## Decision

`services/paper-fills.mjs` exports `simulatePaperFill` and `PAPER_FILL_LIMITATIONS`.

The book is the status already published for `readSpotDepthView`, at bound 10, 25, or 50. A view that is not executable returns no fill and no prices. The error is the view reason, including `stale stream` and `sequence gap`. `lastPrice` is `last price is not a fill` and is not echoed.

A marketable buy consumes asks from the lowest price. A marketable sell consumes bids from the highest price. The same price is aggregated before the walk. Each consumed level records the price, the quantity taken, and the quantity left on that level. A quantity the visible side covers is state `fill`. A quantity the visible side does not cover is state `partial fill` for the consumed remainder. The unfilled quantity is the part the book did not have. No price is invented for that remainder. This partial is not the round trip in `readExecutionCost`. That function still returns `depth is not sufficient` for an uncovered quantity and was not changed.

Spread is the depth-view spread. The fee is the caller fee rate times the filled notional, once. Explicit fee `0` stays `0`. The source names no fee tier. A caller latency is required and is stored. `latencyApplied` stays false. The source names no latency model and no latency unit, so the decimal is not converted and does not change the levels. Limit orders and queue position stay `NOT IN SOURCE`. The module does not append a paper-order event and does not import a venue client. `venueClient` stays null. `liveOrderSubmitted` stays false. No PostgreSQL table was added.

## Evidence

`pnpm test:paper-fills` passed 3/3, duration_ms 261.225291. A buy of `4` on the decision 0034 book consumes `3` at `0.0026` and `1` at `0.0027`, with average `0.002625`, notional `0.0105`, and fee `0.0000105`. That average matches `readExecutionCost` `averageBuy`. The one-sided fee is not the round-trip fee return. A buy of `3` stays on the touch. A buy of `2` leaves `1` on the first ask. A buy of `3.5` takes `0.5` from the second ask and averages `183/70000`. A sell of `4` consumes `3` at `0.0025` and `1` at `0.0024`, with average `0.002475`. A buy of `5` is `partial fill`, filled `4`, unfilled `1`. `readExecutionCost` for quantity `5` remains `depth is not sufficient`. Latency `5` stores that fixture and leaves the levels, average, and fee unchanged. `latencyApplied` stays false. Fee `0` stays `0`. Two ask rows of `1` and `2` at `0.0026` are consumed as one level of `3`. A stale stream, a sequence gap, and a crossed book return no fill and do not echo `0.0026`. `lastPrice` `0.001` is `last price is not a fill` and is not echoed. A missing latency is `latency is not configured`. Evidence text `bearer fixture-token` is not echoed. The module calls `readSpotDepthView` and does not call `readExecutionCost`, `appendPaperOrder`, or a venue client. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Fee `0.001` and latency `0` and `5` are fixtures and are NOT IN SOURCE. Decision 0067 records the passive queue assumptions and does not change these marketable fills.
