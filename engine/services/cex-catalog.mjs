import { SPOT_REST_ORIGIN, SPOT_STREAM_LIFECYCLE, SPOT_STREAM_ORIGIN } from "./binance-spot-public.mjs";

// Public market data is open for all 15 listed venues.
// Upbit futures stay closed: Upbit does not publish that book. No order route is opened.
export const CEX_RANK_NOTE =
  "Order is a connection plan from CoinGecko 2025 CEX spot share, then established public-API venues. Not a live volume feed.";

const PLAN_STEPS = Object.freeze([
  "Listed in the connection plan",
  "Public socket opened",
  "Limits recorded",
  "Fields mapped",
  "Used on this website",
]);

function bookPlan(state, error, uses, feed) {
  const doneCount = state === "live" ? PLAN_STEPS.length : state === "listed" ? 1 : 0;
  return Object.freeze({
    state,
    error,
    feed,
    steps: Object.freeze(PLAN_STEPS.map((name, index) => Object.freeze({
      name,
      done: index < doneCount,
    }))),
    uses: Object.freeze(uses),
  });
}

const NOT_CONNECTED = "ERROR · API is not connected. No socket is open, so this feed is not live and this website does not use it.";
const NOT_IN_BOOK = "ERROR · This book is outside the plan. No API is opened and nothing on the website reads it.";

function closedVenue(rank, id, name, futures) {
  return Object.freeze({
    rank,
    id,
    name,
    spot: bookPlan("listed", NOT_CONNECTED, [], null),
    futures: bookPlan(futures === "plan" ? "listed" : "absent", futures === "plan" ? NOT_CONNECTED : NOT_IN_BOOK, [], null),
  });
}

export const CEX_VENUES = Object.freeze([
  Object.freeze({
    rank: 1,
    id: "binance",
    name: "Binance",
    spot: bookPlan("live", null, [
      "Market · Spot top of book",
      "Market · recent trades",
      "Market · sparkline",
      "Market · Spot API v3 book ticker",
    ], "binance-spot"),
    futures: bookPlan("live", null, [
      "Market · mark price",
      "Market · index price",
      "Market · funding",
      "Market · mark average",
      "Market · settle estimate",
    ], "binance-futures"),
  }),
  Object.freeze({
    rank: 2,
    id: "bybit",
    name: "Bybit",
    spot: bookPlan("live", null, [
      "Admin · Bybit spot top of book",
    ], "bybit-spot"),
    futures: bookPlan("live", null, [
      "Admin · Bybit linear top of book",
    ], "bybit-linear"),
  }),
  Object.freeze({
    rank: 3,
    id: "okx",
    name: "OKX",
    spot: bookPlan("live", null, [
      "Admin · OKX spot public connections",
    ], "okx-spot"),
    futures: bookPlan("live", null, [
      "Admin · OKX swap public connections",
    ], "okx-swap"),
  }),
  Object.freeze({
    rank: 4,
    id: "coinbase",
    name: "Coinbase Exchange",
    spot: bookPlan("live", null, ["Admin · Coinbase spot public connections"], "coinbase-spot"),
    futures: bookPlan("live", null, ["Admin · Coinbase futures public connections"], "coinbase-futures"),
  }),
  Object.freeze({
    rank: 5,
    id: "kraken",
    name: "Kraken",
    spot: bookPlan("live", null, ["Admin · Kraken spot public connections"], "kraken-spot"),
    futures: bookPlan("live", null, ["Admin · Kraken futures public connections"], "kraken-futures"),
  }),
  Object.freeze({
    rank: 6,
    id: "kucoin",
    name: "KuCoin",
    spot: bookPlan("live", null, ["Admin · KuCoin spot public connections"], "kucoin-spot"),
    futures: bookPlan("live", null, ["Admin · KuCoin futures public connections"], "kucoin-futures"),
  }),
  Object.freeze({
    rank: 7,
    id: "gate",
    name: "Gate",
    spot: bookPlan("live", null, ["Admin · Gate spot public connections"], "gate-spot"),
    futures: bookPlan("live", null, ["Admin · Gate futures public connections"], "gate-futures"),
  }),
  Object.freeze({
    rank: 8,
    id: "bitget",
    name: "Bitget",
    spot: bookPlan("live", null, ["Admin · Bitget spot public connections"], "bitget-spot"),
    futures: bookPlan("live", null, ["Admin · Bitget futures public connections"], "bitget-futures"),
  }),
  Object.freeze({
    rank: 9,
    id: "mexc",
    name: "MEXC",
    spot: bookPlan("live", null, ["Admin · MEXC spot public connections"], "mexc-spot"),
    futures: bookPlan("live", null, ["Admin · MEXC futures public connections"], "mexc-futures"),
  }),
  Object.freeze({
    rank: 10,
    id: "htx",
    name: "HTX",
    spot: bookPlan("live", null, ["Admin · HTX spot public connections"], "htx-spot"),
    futures: bookPlan("live", null, ["Admin · HTX futures public connections"], "htx-futures"),
  }),
  Object.freeze({
    rank: 11,
    id: "crypto-com",
    name: "Crypto.com Exchange",
    spot: bookPlan("live", null, ["Admin · Crypto.com spot public connections"], "crypto-spot"),
    futures: bookPlan("live", null, ["Admin · Crypto.com perpetual public connections"], "crypto-futures"),
  }),
  Object.freeze({
    rank: 12,
    id: "upbit",
    name: "Upbit",
    spot: bookPlan("live", null, ["Admin · Upbit spot public connections"], "upbit-spot"),
    futures: bookPlan("absent", "ERROR · This book is outside the plan. No API is opened and nothing on the website reads it.", [], null),
  }),
  Object.freeze({
    rank: 13,
    id: "bitfinex",
    name: "Bitfinex",
    spot: bookPlan("live", null, ["Admin · Bitfinex spot public connections"], "bitfinex-spot"),
    futures: bookPlan("live", null, ["Admin · Bitfinex perpetual public connections"], "bitfinex-futures"),
  }),
  Object.freeze({
    rank: 14,
    id: "bitstamp",
    name: "Bitstamp",
    spot: bookPlan("live", null, ["Admin · Bitstamp spot public connections"], "bitstamp-spot"),
    futures: bookPlan("live", null, ["Admin · Bitstamp perpetual public connections"], "bitstamp-futures"),
  }),
  Object.freeze({
    rank: 15,
    id: "gemini",
    name: "Gemini",
    spot: bookPlan("live", null, ["Admin · Gemini spot public connections"], "gemini-spot"),
    futures: bookPlan("live", null, ["Admin · Gemini perpetual public connections"], "gemini-futures"),
  }),
]);

// Official Binance product launched 5 October 2026. This portal has no session for it.
export const BINANCE_WS_API_V3 = Object.freeze({
  name: "WebSocket API v3",
  docsUrl: "https://developers.binance.com/en/docs/products/spot/web-socket-api",
  origin: "wss://ws-api.binance.com:443/ws-api/v3",
  checkedAt: "2026-10-07",
  method: "ticker.book",
  symbol: "BTCUSDT",
  weight: 2,
  requestWeightLimit: "6000 per minute",
  connectionValid: "24 hours",
  serverPing: "20 seconds",
  pongDeadline: "1 minute",
  connectionAttempts: "300 connections per 5 minutes per IP",
  conditions: Object.freeze([
    "This is the request WebSocket API, not the Market push streams.",
    "The panel sends only ticker.book for BTCUSDT. Weight is 2.",
    "Signed methods such as order.place are not sent. No API key is used.",
    "A connection lasts 24 hours. The server pings every 20 seconds and expects a pong within 1 minute.",
    "REQUEST_WEIGHT allowance is 6000 per minute.",
    "At most 300 connections per 5 minutes per IP.",
    "A non-200 status is an error. It is not shown as a price.",
  ]),
  fields: Object.freeze([
    Object.freeze({ field: "method", meaning: "Request name", limit: "ticker.book only in this panel", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "symbol", meaning: "Requested symbol", limit: "BTCUSDT", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "bidPrice", meaning: "Best bid", limit: "Decimal string", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "bidQty", meaning: "Best bid quantity", limit: "Decimal string", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "askPrice", meaning: "Best ask", limit: "Decimal string", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "askQty", meaning: "Best ask quantity", limit: "Decimal string", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "status", meaning: "HTTP-style response status", limit: "200 is success. Anything else is an error", used: "Admin · WebSocket API v3" }),
    Object.freeze({ field: "REQUEST_WEIGHT", meaning: "Used request weight", limit: "6000 per minute", used: "Admin · WebSocket API v3" }),
  ]),
});

export const BINANCE_INTELLIGENCE = Object.freeze({
  launched: "2026-10-05",
  products: Object.freeze([
    Object.freeze({
      id: "binance-ai",
      name: "Binance AI",
      state: "error",
      error: "ERROR · Not connected. Binance AI is Binance's own app. This portal has no session.",
      uses: Object.freeze([]),
    }),
    Object.freeze({
      id: "ai-pro",
      name: "Binance AI Pro",
      state: "error",
      error: "ERROR · Not connected. Strategy running stays locked. No order route is open.",
      uses: Object.freeze([]),
    }),
    Object.freeze({
      id: "agent-os",
      name: "Agent OS",
      state: "error",
      error: "ERROR · Not connected. No Agent OS key is configured.",
      uses: Object.freeze([]),
    }),
  ]),
});


// Checked 2026-10-07 against the USD-M websocket connect page.
export const BINANCE_FUTURES_STREAM_LIMITS = Object.freeze({
  docsUrl: "https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect",
  markDocsUrl: "https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market",
  checkedAt: "2026-10-07",
  origin: "wss://fstream.binance.com/market",
  connectionValid: "24 hours",
  serverPing: "3 minutes",
  pongDeadline: "10 minutes",
  incomingMessagesPerSecond: 10,
  maxStreams: 1024,
  updateSpeed: "1s on @markPrice@1s, otherwise 3s",
  condition: "markPrice is served on /market. No order or private stream is opened.",
});

export const BINANCE_SPOT_SOCKET = Object.freeze({
  origin: SPOT_STREAM_ORIGIN,
  restOrigin: SPOT_REST_ORIGIN,
  streams: Object.freeze(["{symbol}@trade", "{symbol}@bookTicker"]),
  limits: SPOT_STREAM_LIFECYCLE,
  conditions: Object.freeze([
    "Public market-data host only. No API key and no order route.",
    "Symbol must match A-Z and 0-9. Any other stream name is rejected.",
    "A connection lasts 24 hours, then it must reconnect and resubscribe.",
    "Server ping is every 20 seconds. A pong is required within 1 minute.",
    "At most 5 incoming control messages per second.",
    "At most 1024 streams on one connection.",
    "At most 300 connection attempts every 5 minutes per IP.",
    "An invalid frame is ignored. It is never stored as zero.",
    "The page calls the feed stale after 10 seconds without a frame.",
    "Reconnect waits from 1 second and doubles, capped at 15 seconds.",
    "The page keeps the last 12 trades. Older prints are dropped on screen only.",
  ]),
});

export const BINANCE_FUTURES_SOCKET = Object.freeze({
  origin: BINANCE_FUTURES_STREAM_LIMITS.origin,
  streams: Object.freeze(["{symbol}@markPrice@1s"]),
  limits: BINANCE_FUTURES_STREAM_LIMITS,
  conditions: Object.freeze([
    "Public market stream only. No API key and no order route.",
    "The stream is pinned to /market. The old /ws markPrice path is not used.",
    "A connection lasts 24 hours, then it must reconnect.",
    "Server ping is every 3 minutes. A pong is required within 10 minutes.",
    "At most 10 incoming messages per second.",
    "At most 1024 streams on one connection.",
    "Update speed for this socket is 1 second.",
    "Estimated settle price P is only useful in the last hour before settlement.",
    "An invalid frame is ignored. It is never stored as zero.",
    "The page calls the feed stale after 10 seconds without a frame.",
  ]),
});

// wasHidden marks payload fields the socket already delivered and the page used to drop.
export const BINANCE_SPOT_FIELDS = Object.freeze([
  Object.freeze({ stream: "bookTicker", field: "s", meaning: "Symbol", limit: "Must match the subscribed symbol", used: "Market · book header", wasHidden: true }),
  Object.freeze({ stream: "bookTicker", field: "b", meaning: "Best bid price", limit: "Decimal string", used: "Market · best bid", wasHidden: false }),
  Object.freeze({ stream: "bookTicker", field: "B", meaning: "Best bid quantity", limit: "Decimal string", used: "Market · best bid size", wasHidden: false }),
  Object.freeze({ stream: "bookTicker", field: "a", meaning: "Best ask price", limit: "Decimal string", used: "Market · best ask", wasHidden: false }),
  Object.freeze({ stream: "bookTicker", field: "A", meaning: "Best ask quantity", limit: "Decimal string", used: "Market · best ask size", wasHidden: false }),
  Object.freeze({ stream: "bookTicker", field: "u", meaning: "Order book update id", limit: "Whole number", used: "Market · book update id", wasHidden: true }),
  Object.freeze({ stream: "trade", field: "e", meaning: "Event name", limit: "Must be trade", used: "Parser gate only", wasHidden: false }),
  Object.freeze({ stream: "trade", field: "E", meaning: "Event time", limit: "Unix milliseconds", used: "Market · trade event time", wasHidden: true }),
  Object.freeze({ stream: "trade", field: "s", meaning: "Symbol", limit: "Must match the subscribed symbol", used: "Market · trade symbol", wasHidden: true }),
  Object.freeze({ stream: "trade", field: "t", meaning: "Trade id", limit: "Whole number", used: "Market · trade id", wasHidden: true }),
  Object.freeze({ stream: "trade", field: "p", meaning: "Price", limit: "Decimal string", used: "Market · price, sparkline", wasHidden: false }),
  Object.freeze({ stream: "trade", field: "q", meaning: "Quantity", limit: "Decimal string", used: "Market · quantity and 12-print imbalance", wasHidden: false }),
  Object.freeze({ stream: "trade", field: "T", meaning: "Trade time", limit: "Unix milliseconds", used: "Market · trade clock", wasHidden: false }),
  Object.freeze({ stream: "trade", field: "m", meaning: "Buyer is the maker", limit: "Boolean. true means the taker sold", used: "Market · taker side", wasHidden: false }),
  Object.freeze({ stream: "trade", field: "M", meaning: "Best-match flag", limit: "Boolean. Docs say ignore for strategy", used: "Market · best-match column", wasHidden: true }),
]);

export const BINANCE_FUTURES_FIELDS = Object.freeze([
  Object.freeze({ stream: "markPrice@1s", field: "e", meaning: "Event name", limit: "markPriceUpdate", used: "Market · event name", wasHidden: true }),
  Object.freeze({ stream: "markPrice@1s", field: "E", meaning: "Event time", limit: "Unix milliseconds", used: "Market · event time", wasHidden: true }),
  Object.freeze({ stream: "markPrice@1s", field: "s", meaning: "Symbol", limit: "Must match the subscribed symbol", used: "Market · futures symbol", wasHidden: true }),
  Object.freeze({ stream: "markPrice@1s", field: "p", meaning: "Mark price", limit: "Decimal string", used: "Market · mark price", wasHidden: false }),
  Object.freeze({ stream: "markPrice@1s", field: "i", meaning: "Index price", limit: "Decimal string. Not a kline close", used: "Market · index price", wasHidden: false }),
  Object.freeze({ stream: "markPrice@1s", field: "P", meaning: "Estimated settle price", limit: "Useful only in the last hour before settlement", used: "Market · settle estimate", wasHidden: true }),
  Object.freeze({ stream: "markPrice@1s", field: "r", meaning: "Funding rate", limit: "Decimal string", used: "Market · funding rate", wasHidden: false }),
  Object.freeze({ stream: "markPrice@1s", field: "ap", meaning: "Mark price moving average", limit: "Decimal string", used: "Market · mark average", wasHidden: true }),
  Object.freeze({ stream: "markPrice@1s", field: "T", meaning: "Next funding time", limit: "Unix milliseconds", used: "Market · next funding", wasHidden: false }),
]);
