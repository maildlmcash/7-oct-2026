# 0033 — Spot snapshot and delta sequencing

Status: accepted for the Spot local-book sequence rules.

## Context

TASK 08.B.01 asks for a snapshot plus incremental L2 deltas under the selected venue's official sequence rules. A gap or an invalid update resets the book and asks for a new snapshot. Out-of-order, duplicate, gap, snapshot-race, and reconnect cases must leave the book valid or explicitly invalid.

The selected venue is Binance Spot. Decision 0029 already keeps that diff-depth book in `services/spot-book-sync.mjs`. The local-book section of `https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md` was read on 2026-10-06. It says to buffer events and remember the `U` of the first event. A snapshot whose `lastUpdateId` is strictly less than that `U` is fetched again. Buffered events with `u` less than or equal to the snapshot id are discarded. The first remaining event must contain that snapshot id. A later event whose `U` is greater than the local update id plus 1 discards the book. An event whose `u` is less than the local update id is ignored. The same section's examples still name `stream.binance.com` and `api.binance.com`. This module keeps the market-data-only hosts from decision 0026. The depth stream name stays off the trade and bookTicker allow-list.

The official ignore sentence covers a final id strictly below the local id. Decision 0029 treats a final id equal to the local id as a duplicate and hides the book. That equal-id behavior stays in place. No guess was made to collapse the two cases.

## Decision

`services/spot-book-sync.mjs` applies the steps above. Events that arrive before a snapshot stay buffered. An older snapshot does not publish the book, and later deltas stay buffered until a snapshot bridges the first received `U`. An event that arrives out of order does not lower that first `U`. A final id below the local id is ignored and the current book stays in place. A final id equal to the local id remains an explicit duplicate. A gap, a reconnect, and a depth payload that fails the documented shape each discard the book and set the action to `resnapshot`. No socket is opened. No order is placed. Decision 0034 reads this book as bounded depth without using last trade price.

## Evidence

`pnpm test:spot-l2-sequence` passed 6/6. An out-of-order buffer stays unpublished until snapshot id `161` bridges the first received `U`. Final id `159` leaves update id `160` and quantity `10` in place. An equal final id hides the book. A gap from `U` `162` stays hidden until snapshot id `162`. Snapshot id `156` loses the race to first `U` `157`, and the later delta quantity `12` appears only after the bridge. Reconnect and a payload with `U` greater than `u` both require a new snapshot. `pnpm test:spot-book-sync` passed 4/4. `pnpm health` stayed `liveTrading` `OFF` and `liveOrdersLocked` true.
