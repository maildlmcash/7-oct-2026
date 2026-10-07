# 0029 — Spot feed gaps and resync

Status: accepted for Spot diff-depth gap detection.

## Context

TASK 07.B.02 asks for sequence gaps, stale streams, clock skew, and duplicate events. Affected intervals stay invalid until healed. Resnapshot and reconnect follow the official feed contract.

The Spot stream document checked for decision 0026 says a diff-depth event whose first update id is greater than the local book update id plus 1 means events were missed. The local book is discarded and the process restarts from a depth snapshot. Events whose final update id is less than or equal to the snapshot update id are discarded. The first kept event must contain that snapshot id. A ping without a copied pong within one minute disconnects the socket. A connection ends at 24 hours. `serverShutdown`, a close, and that deadline already reconnect in `services/binance-spot-public.mjs`. The same document says timestamps are milliseconds and names no clock-skew allowance. Decision 0028 keeps the canonical envelope free of gap detection.

## Decision

`services/spot-book-sync.mjs` buffers `<symbol>@depth` events and accepts a snapshot only when `lastUpdateId` can bridge the first buffered event. Until that bridge exists, the book is not healthy. A later gap discards the book, records an unhealed interval, and asks for a resnapshot. A repeated update id is a duplicate and is not healthy data. A pending ping that reaches the one-minute deadline, or a connection that reaches 24 hours, latches the stream stale until reconnect. Reconnect clears the book. An event time greater than the receive time marks clock skew until a later applied event has a receive time at or after its event time. No skew allowance is added. The resnapshot URL is `GET /api/v3/depth` with limit 5000 on `https://data-api.binance.vision`. The depth stream URL uses `wss://data-stream.binance.vision:443/ws/<symbol>@depth`. The trade and bookTicker allow-list is unchanged. The local-book section still shows `api.binance.com` and `stream.binance.com` in its example. Decision 0030 keeps bounded queueing in a separate module. Decision 0033 records the out-of-order and snapshot-race checks on this book.

## Evidence

`pnpm test:spot-book-sync` covers an open sequence gap, a snapshot that does not bridge, a duplicate update, the pong deadline, the 24-hour connection, reconnect before a new snapshot, and clock skew. Each fault reports healthy false and omits the book. A later bridge or aligned event is required before healthy data is returned.
