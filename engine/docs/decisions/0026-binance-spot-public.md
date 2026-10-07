# 0026 — Binance public Spot market data

Status: accepted for the public Spot adapter.

## Context

TASK 07.A.01 asks for Binance public Spot trades, best bid/offer, instrument metadata, and the documented socket lifecycle. Order credentials and order placement stay out of this task.

Decision 0001 keeps exchange adapters apart from execution credentials. `services/provider-registry.mjs` stores provider configuration and does not open a connection. Design section 4 names the Binance docs portal and keeps Spot separate from USD-M, COIN-M, options, and user streams. The source names no adapter package layout.

## Decision

`services/binance-spot-public.mjs` reads public Spot market data only. Stream names are `<symbol>@trade` and `<symbol>@bookTicker`. REST reads are `GET /api/v3/trades`, `GET /api/v3/ticker/bookTicker`, and `GET /api/v3/exchangeInfo` on `https://data-api.binance.vision`. The socket host is `wss://data-stream.binance.vision:443`. Prices and quantities stay decimal strings.

The socket follows the spot market-stream document checked on 2026-10-06. The changelog version recorded for that check is 2026-09-18. A connection is treated as finished at 24 hours. A server ping requires a pong that copies the ping payload. An empty unsolicited pong does not satisfy that ping. A missed pong minute, a close, or a `serverShutdown` event opens a new connection and sends `SUBSCRIBE` again. The module does not send an order request, an API key, or a signature. Decision 0027 keeps USD-M futures in a separate adapter. Decision 0029 adds `GET /api/v3/depth` with limit 5000 for the official order-book resnapshot. The trade and bookTicker stream allow-list stays unchanged.

## Evidence

`pnpm test:binance-spot-public` covers the official trade, book ticker, and exchangeInfo fixtures, a numeric price rejection, ping copy, unsolicited pong, close, server shutdown, the 24-hour reconnect, and one bounded public book ticker read for BTCUSDT.
