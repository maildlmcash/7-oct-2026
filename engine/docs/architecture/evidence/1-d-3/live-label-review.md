# LIVE label review — task 1.D.3

Recorded: 2026-10-07T13:02:44.254Z.
Owner: DLM CASH.
Truth label: CONNECTED-READ-ONLY for the two public sockets. Lock copy is PAPER-SIMULATED.

## Lock copy

`LIVE ORDERS LOCKED` remains on the masthead and the workspace pill. Source: `apps/web/health.mjs` with `liveOrdersLocked: true`. These labels are not an observation and are not verified live.

## Status pills captured on the market screen

status-pill-spot: LIVE · wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker · 2026-10-07T12:59:56.869Z

status-pill-futures: LIVE · wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s · 2026-10-07T12:59:56.618Z

The word LIVE is produced only by `observationLabel` when the status is live, the source is non-empty, and `seenAt` formats as an ISO-8601 Z timestamp. Other exchange panels use that same function. A plan whose steps are complete says PLAN READY, not LIVE.

## Result

PASS. Lock copy is not verified live. The captured status lines have a source and a last-seen time.
