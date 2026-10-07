// Public Binance Spot market data for TASK 07.A.01.
// Docs checked 2026-10-06. Changelog last updated 2026-09-18.
// Streams and REST shapes are the official trade, bookTicker, and exchangeInfo examples.
// Socket rules are the spot market-stream rules: a connection lasts 24 hours,
// the server pings every 20 seconds, and a copied pong is required within one minute.
// serverShutdown and a dropped connection reconnect and resubscribe.
// Market-data-only hosts are used. This module has no order route and no credential.

export const BINANCE_SPOT_PUBLIC_DOCS = Object.freeze({
  venueDocsUrl: "https://developers.binance.com/en/docs",
  streamsUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md",
  restUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md",
  marketDataOnlyUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md",
  changelogUrl: "https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md",
  version: "2026-09-18",
  checkedAt: "2026-10-06",
});

export const SPOT_STREAM_LIFECYCLE = Object.freeze({
  connectionValid: "24 hours",
  connectionValidMs: 24 * 60 * 60 * 1000,
  serverPing: "20 seconds",
  serverPingMs: 20 * 1000,
  pongDeadline: "1 minute",
  pongDeadlineMs: 60 * 1000,
  incomingControlPerSecond: 5,
  maxStreams: 1024,
  connectionAttempts: "300 connections per attempt every 5 minutes per IP",
});

export const SPOT_REST_ORIGIN = "https://data-api.binance.vision";
export const SPOT_STREAM_ORIGIN = "wss://data-stream.binance.vision:443";
const REST_ORIGIN = SPOT_REST_ORIGIN;
const STREAM_ORIGIN = SPOT_STREAM_ORIGIN;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const STREAMS = new Set(["trade", "bookTicker"]);
const PATHS = Object.freeze({
  trades: "/api/v3/trades",
  bookTicker: "/api/v3/ticker/bookTicker",
  exchangeInfo: "/api/v3/exchangeInfo",
  depth: "/api/v3/depth",
});
const DEPTH_SNAPSHOT_LIMIT = 5000;

function fail(error) {
  return { ok: false, error };
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function whole(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function symbol(value) {
  return typeof value === "string" && SYMBOL.test(value);
}

export function spotStreamName(value, channel) {
  if (!symbol(value)) return fail("symbol is not allowed");
  if (!STREAMS.has(channel)) return fail("stream is not allowed");
  return { ok: true, stream: `${value.toLowerCase()}@${channel}` };
}

export function spotStreamUrl(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return fail("stream is required");
  if (streams.length > SPOT_STREAM_LIFECYCLE.maxStreams) return fail("stream is not allowed");
  const names = [];
  for (const stream of streams) {
    if (typeof stream !== "string" || !/^[a-z0-9]+@(trade|bookTicker)$/.test(stream)) {
      return fail("stream is not allowed");
    }
    names.push(stream);
  }
  if (names.length === 1) {
    return { ok: true, url: `${STREAM_ORIGIN}/ws/${names[0]}` };
  }
  return { ok: true, url: `${STREAM_ORIGIN}/stream?streams=${names.join("/")}` };
}

export function publicMarketUrl(path, query) {
  if (path !== PATHS.trades && path !== PATHS.bookTicker && path !== PATHS.exchangeInfo && path !== PATHS.depth) {
    return fail("orders are closed");
  }
  const source = query && typeof query === "object" ? query : {};
  if (!symbol(source.symbol)) return fail("symbol is not allowed");
  const params = new URLSearchParams();
  params.set("symbol", source.symbol);
  if (path === PATHS.depth) {
    if (source.limit !== DEPTH_SNAPSHOT_LIMIT) return fail("limit is not allowed");
    params.set("limit", String(DEPTH_SNAPSHOT_LIMIT));
  } else if (path === PATHS.trades && source.limit != null) {
    if (!whole(source.limit) || source.limit < 1 || source.limit > 1000) {
      return fail("limit is not allowed");
    }
    params.set("limit", String(source.limit));
  } else if (source.limit != null) {
    return fail("limit is not allowed");
  }
  for (const key of Object.keys(source)) {
    if (key !== "symbol" && key !== "limit") return fail("orders are closed");
  }
  return {
    ok: true,
    method: "GET",
    url: `${REST_ORIGIN}${path}?${params.toString()}`,
  };
}

function tradeEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("trade schema is not allowed");
  if (value.e !== "trade") return fail("trade schema is not allowed");
  if (!whole(value.E) || !symbol(value.s) || !whole(value.t)) return fail("trade schema is not allowed");
  if (!decimal(value.p) || !decimal(value.q) || !whole(value.T)) return fail("trade schema is not allowed");
  if (typeof value.m !== "boolean" || typeof value.M !== "boolean") return fail("trade schema is not allowed");
  return {
    ok: true,
    kind: "spot-trade",
    event: {
      e: "trade",
      E: value.E,
      s: value.s,
      t: value.t,
      p: value.p,
      q: value.q,
      T: value.T,
      m: value.m,
      M: value.M,
    },
  };
}

function bookTickerEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("book ticker schema is not allowed");
  }
  if (value.e != null) return fail("book ticker schema is not allowed");
  if (!whole(value.u) || !symbol(value.s)) return fail("book ticker schema is not allowed");
  if (!decimal(value.b) || !decimal(value.B) || !decimal(value.a) || !decimal(value.A)) {
    return fail("book ticker schema is not allowed");
  }
  return {
    ok: true,
    kind: "spot-book-ticker",
    event: {
      u: value.u,
      s: value.s,
      b: value.b,
      B: value.B,
      a: value.a,
      A: value.A,
    },
  };
}

export function parseSpotStreamMessage(value) {
  let message = value;
  if (typeof value === "string") {
    try {
      message = JSON.parse(value);
    } catch {
      return fail("stream message is not allowed");
    }
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return fail("stream message is not allowed");
  }
  if (typeof message.stream === "string" && message.data && typeof message.data === "object") {
    const inner = parseSpotStreamMessage(message.data);
    if (!inner.ok) return inner;
    return { ...inner, stream: message.stream };
  }
  if (message.e === "serverShutdown") {
    if (!whole(message.E)) return fail("stream message is not allowed");
    return { ok: true, kind: "server-shutdown", event: { e: "serverShutdown", E: message.E } };
  }
  if (message.e === "trade") return tradeEvent(message);
  if (message.u != null && message.b != null) return bookTickerEvent(message);
  if (Object.prototype.hasOwnProperty.call(message, "result") && Object.prototype.hasOwnProperty.call(message, "id")) {
    return { ok: true, kind: "stream-control", event: { result: message.result, id: message.id } };
  }
  return fail("stream message is not allowed");
}

export function parseRecentTrades(value) {
  if (!Array.isArray(value) || value.length === 0) return fail("trade schema is not allowed");
  const trades = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return fail("trade schema is not allowed");
    if (!whole(row.id) || !decimal(row.price) || !decimal(row.qty) || !decimal(row.quoteQty)) {
      return fail("trade schema is not allowed");
    }
    if (!whole(row.time) || typeof row.isBuyerMaker !== "boolean" || typeof row.isBestMatch !== "boolean") {
      return fail("trade schema is not allowed");
    }
    trades.push({
      id: row.id,
      price: row.price,
      qty: row.qty,
      quoteQty: row.quoteQty,
      time: row.time,
      isBuyerMaker: row.isBuyerMaker,
      isBestMatch: row.isBestMatch,
    });
  }
  return { ok: true, kind: "spot-trade", trades };
}

export function parseRestBookTicker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("book ticker schema is not allowed");
  }
  if (!symbol(value.symbol)) return fail("book ticker schema is not allowed");
  if (!decimal(value.bidPrice) || !decimal(value.bidQty) || !decimal(value.askPrice) || !decimal(value.askQty)) {
    return fail("book ticker schema is not allowed");
  }
  return {
    ok: true,
    kind: "spot-book-ticker",
    book: {
      symbol: value.symbol,
      bidPrice: value.bidPrice,
      bidQty: value.bidQty,
      askPrice: value.askPrice,
      askQty: value.askQty,
    },
  };
}

function instrument(value) {
  if (!value || typeof value !== "object") return fail("instrument schema is not allowed");
  if (!symbol(value.symbol) || !text(value.status) || !text(value.baseAsset) || !text(value.quoteAsset)) {
    return fail("instrument schema is not allowed");
  }
  if (!whole(value.baseAssetPrecision) || !whole(value.quoteAssetPrecision)) {
    return fail("instrument schema is not allowed");
  }
  if (typeof value.isSpotTradingAllowed !== "boolean") return fail("instrument schema is not allowed");
  return {
    ok: true,
    symbol: {
      symbol: value.symbol,
      status: value.status,
      baseAsset: value.baseAsset,
      baseAssetPrecision: value.baseAssetPrecision,
      quoteAsset: value.quoteAsset,
      quoteAssetPrecision: value.quoteAssetPrecision,
      isSpotTradingAllowed: value.isSpotTradingAllowed,
    },
  };
}

export function parseExchangeInfo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("instrument schema is not allowed");
  }
  if (!text(value.timezone) || !whole(value.serverTime) || !Array.isArray(value.symbols)) {
    return fail("instrument schema is not allowed");
  }
  if (value.symbols.length === 0) return fail("instrument schema is not allowed");
  const symbols = [];
  for (const row of value.symbols) {
    const parsed = instrument(row);
    if (!parsed.ok) return parsed;
    symbols.push(parsed.symbol);
  }
  return {
    ok: true,
    kind: "spot-instrument",
    timezone: value.timezone,
    serverTime: value.serverTime,
    symbols,
  };
}

export function createPublicStreamSession(input) {
  const source = input && typeof input === "object" ? input : {};
  const located = spotStreamUrl(source.streams);
  if (!located.ok) return located;
  const now = source.now;
  if (typeof now !== "function") return fail("clock is required");
  const state = {
    url: located.url,
    streams: [...source.streams],
    transport: null,
    connectedAt: null,
    pendingPing: null,
    nextId: 1,
    controls: [],
    reconnects: [],
    events: [],
    closing: false,
  };

  function sendControl(payload) {
    const at = now();
    state.controls = state.controls.filter((entry) => at - entry < 1000);
    if (state.controls.length >= SPOT_STREAM_LIFECYCLE.incomingControlPerSecond) {
      return fail("stream control limit");
    }
    state.controls.push(at);
    state.transport.send(JSON.stringify(payload));
    return { ok: true };
  }

  function subscribe() {
    const id = state.nextId;
    state.nextId += 1;
    return sendControl({ method: "SUBSCRIBE", params: state.streams, id });
  }

  function reconnect(reason) {
    if (!state.transport || state.closing) return { ok: false, error: "stream is closed" };
    state.closing = true;
    state.transport.close();
    state.closing = false;
    state.pendingPing = null;
    state.connectedAt = now();
    state.transport.connect(state.url);
    const sent = subscribe();
    if (!sent.ok) return sent;
    state.reconnects.push(reason);
    return { ok: true, reason };
  }

  return {
    url: state.url,
    connect(transport) {
      state.transport = transport;
      state.connectedAt = now();
      transport.connect(state.url);
      return subscribe();
    },
    onServerPing(payload) {
      const copy = typeof payload === "string" ? payload : "";
      state.pendingPing = { payload: copy, at: now() };
      const sent = state.transport.pong(copy);
      if (sent !== false) state.pendingPing = null;
      return { ok: true, pong: copy };
    },
    onUnsolicitedPong() {
      const at = now();
      state.controls = state.controls.filter((entry) => at - entry < 1000);
      if (state.controls.length >= SPOT_STREAM_LIFECYCLE.incomingControlPerSecond) {
        return fail("stream control limit");
      }
      state.controls.push(at);
      state.transport.pong("");
      return { ok: true, satisfied: state.pendingPing == null };
    },
    onMessage(payload) {
      const parsed = parseSpotStreamMessage(payload);
      if (!parsed.ok) return parsed;
      if (parsed.kind === "server-shutdown") {
        state.events.push(parsed);
        return reconnect("serverShutdown");
      }
      state.events.push(parsed);
      return parsed;
    },
    onClose() {
      if (state.closing) return { ok: true, ignored: true };
      return reconnect("close");
    },
    tick(at) {
      if (state.connectedAt == null) return fail("stream is closed");
      if (at - state.connectedAt >= SPOT_STREAM_LIFECYCLE.connectionValidMs) {
        return reconnect("24 hours");
      }
      if (state.pendingPing && at - state.pendingPing.at >= SPOT_STREAM_LIFECYCLE.pongDeadlineMs) {
        return reconnect("pong deadline");
      }
      return { ok: true, reconnects: state.reconnects.length };
    },
    snapshot() {
      return {
        reconnects: [...state.reconnects],
        events: state.events.map((entry) => entry.kind),
      };
    },
  };
}

export async function smokeBestBidOffer(input = {}) {
  const located = publicMarketUrl(PATHS.bookTicker, { symbol: input.symbol ?? "BTCUSDT" });
  if (!located.ok) return located;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const response = await fetch(located.url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  const body = await response.json();
  const book = parseRestBookTicker(body);
  if (!response.ok || !book.ok) return fail("book ticker schema is not allowed");
  return {
    ok: true,
    method: "GET",
    url: located.url,
    status: response.status,
    book: book.book,
  };
}
