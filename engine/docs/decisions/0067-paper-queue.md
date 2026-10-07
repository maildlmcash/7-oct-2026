# 0067 — Passive paper queue

Status: accepted for a paper-only passive queue estimate. Every report labels the fill as an estimate. A cancellation or a short print does not invent the missing volume. Live orders stay locked.

## Context

TASK 14.B.02 asks for conservative queue and latency assumptions on passive paper orders, and for those assumptions to appear on every report. Queue tests must cover cancellation and partial volume. Simulated fills must be labeled as estimates.

Design phase 10 names simulated fills and a latency comparison and names no queue position and no latency number. The public trade stream, already parsed by `parseSpotStreamMessage`, says `m` is whether the buyer is the market maker and says to ignore `M`. The same stream says timestamps are milliseconds unless a time unit is set. This module does not set one. Decision 0034 reads the bounded book and does not fill. Decision 0066 fills a marketable order and leaves queue position `NOT IN SOURCE`.

## Decision

`services/paper-queue.mjs` exports `estimatePaperQueue` and `PAPER_QUEUE_ASSUMPTIONS`.

A passive buy must be strictly below the best ask. A passive sell must be strictly above the best bid. A crossing price is `order is not passive` and produces no fill quantity. The order joins behind the visible quantity at its own price. A price with no visible size has queue ahead `0`. Hidden quantity and any priority beyond that visible size stay `NOT IN SOURCE`.

Only a trade parsed from the public trade schema can reduce the queue. The trade must be at the passive price, after the live time, and before a cancel time when one is supplied. A trade at the live time or at the cancel time does not count. A passive buy counts the trade only when the buyer is the market maker. A passive sell counts it only when the buyer is not. `M` is ignored. A repeated trade id is counted once. A print at another price does not fill the order. Another order's cancellation is not an input and does not move the queue ahead. The displayed queue ahead on the report stays the size at join.

Live time is the placed time plus the caller latency on that trade-time clock. Latency does not change the price. `latencyApplied` stays false. The fee is the caller fee rate times the filled notional, once. Explicit fee `0` stays `0`. A zero estimated fill has fee `0`. An invalid book, a stale book, a bad trade, or `lastPrice` produces no quantities. `lastPrice` is `last price is not a fill` and is not echoed.

Every returned report, including a refusal, has `estimate` true and the same assumption list. A covered order is state `fill`. A short print is state `partial fill`. A cancel with size still resting is state `cancel`, and a partial estimate reached before the cancel is kept. The module does not append a paper-order event and does not import an order route. `venueClient` stays null. `liveOrderSubmitted` stays false. No PostgreSQL table was added.

## Evidence

`pnpm test:paper-queue` passed 3/3, duration_ms 223.480163. A passive buy at `0.0025` on the decision 0034 book has queue ahead `3`. A print of `3` estimates filled `0`. Prints of `2` and `2`, supplied out of time order, estimate filled `1` and unfilled `1`, state `partial fill`, notional `0.0025`, and fee `0.0000025`. A print of `5` estimates filled `2`. A buyer-taker print, a print at `9.001`, a print at `0.0024`, a print at the live time, and a repeated trade id do not add a second fill. `9.001` is not copied onto the report. Latency `5` leaves a print at the live time unfilled and a later print filled `1`. A new price `0.00255` has queue ahead `0` and can fill from the next print. A passive sell at `0.0026` has queue ahead `3` and estimates filled `1` from a buyer-taker print of `4`. A buyer-maker print at the ask estimates filled `0`. Fee `0` stays `0`. A cancel before the print is state `cancel` and filled `0`. A cancel between two prints keeps filled `1` and does not count the later print. A buy at the ask `0.0026` is `order is not passive` and does not echo that price. A stale stream returns no quantity and does not echo `0.0025`. `lastPrice` `0.001` is not echoed. A missing latency is `latency is not configured`. Evidence text `bearer fixture-token` is not echoed. A trade missing the public schema is `trade schema is not allowed` and does not echo its price. Every one of those reports has `estimate` true and the assumption list. The module calls `readSpotDepthView` and `parseSpotStreamMessage`. It does not call `appendPaperOrder` or an order route. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Fee `0.001` and latency `0` and `5` are fixtures and are NOT IN SOURCE. Decision 0068 records the paper fault injection and does not change these estimates.
