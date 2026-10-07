export const KRAKEN_SPOT_ORIGIN = "https://api.kraken.com";
export const KRAKEN_FUTURES_ORIGIN = "https://futures.kraken.com";
export const KRAKEN_SPOT_WS = "wss://ws.kraken.com/v2";
export const KRAKEN_FUTURES_WS = "wss://futures.kraken.com/ws/v1";
export const KRAKEN_SPOT_SYMBOL = "BTC/USD";
export const KRAKEN_FUTURES_SYMBOL = "PI_XBTUSD";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function decimal(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Kraken ${book} · ${id}` });
}

export const KRAKEN_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "Ticker", "GET /0/public/Ticker?pair=XBTUSD", `${KRAKEN_SPOT_ORIGIN}/0/public/Ticker?pair=XBTUSD`),
  connection("rest-depth", "spot", "rest", "Depth", "GET /0/public/Depth?pair=XBTUSD&count=1", `${KRAKEN_SPOT_ORIGIN}/0/public/Depth?pair=XBTUSD&count=1`),
  connection("ws-ticker", "spot", "ws", "ticker", JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: ["BTC/USD"] } }), KRAKEN_SPOT_WS),
  connection("ws-trade", "spot", "ws", "trade", JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["BTC/USD"] } }), KRAKEN_SPOT_WS),
  connection("ws-book", "spot", "ws", "book", JSON.stringify({ method: "subscribe", params: { channel: "book", symbol: ["BTC/USD"], depth: 10 } }), KRAKEN_SPOT_WS),
]);

export const KRAKEN_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /derivatives/api/v3/tickers/PI_XBTUSD", `${KRAKEN_FUTURES_ORIGIN}/derivatives/api/v3/tickers/PI_XBTUSD`),
  connection("ws-ticker", "futures", "ws", "ticker", JSON.stringify({ event: "subscribe", feed: "ticker", product_ids: ["PI_XBTUSD"] }), KRAKEN_FUTURES_WS),
]);

export const KRAKEN_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol on the websocket is BTC/USD. REST pair is XBTUSD.",
  "wss://ws-auth.kraken.com/v2 is not opened. No API key and no order route.",
  "This page sends {\"method\":\"ping\"} every 30 seconds on the spot socket.",
]);

export const KRAKEN_FUTURE_CONDITIONS = Object.freeze([
  "Public futures only. Product is PI_XBTUSD.",
  "Private futures feeds are not opened. No API key and no order route.",
  "This page sends {\"event\":\"ping\"} every 30 seconds. Kraken asks for a ping at least every 60 seconds.",
]);

export function explainKraken(connectionId, book, input) {
  const list = book === "spot" ? KRAKEN_SPOT_CONNECTIONS : KRAKEN_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.kind === "rest" && spec.channel === "Ticker") {
    if (!Array.isArray(input.error) || input.error.length !== 0) return null;
    const ticker = Object.values(input.result ?? {})[0];
    if (!ticker || !decimal(ticker.a?.[0]) || !decimal(ticker.b?.[0]) || !decimal(ticker.c?.[0])) return null;
    return [
      row("ask", ticker.a[0], "Best ask"),
      row("bid", ticker.b[0], "Best bid"),
      row("last", ticker.c[0], "Last trade price"),
    ];
  }
  if (spec.kind === "rest" && spec.channel === "Depth") {
    if (!Array.isArray(input.error) || input.error.length !== 0) return null;
    const depth = Object.values(input.result ?? {})[0];
    const bid = depth?.bids?.[0];
    const ask = depth?.asks?.[0];
    if (!decimal(bid?.[0]) || !decimal(ask?.[0])) return null;
    return [
      row("bid", bid[0], "Best bid"),
      row("bid size", bid[1], "Best bid size"),
      row("ask", ask[0], "Best ask"),
      row("ask size", ask[1], "Best ask size"),
    ];
  }
  if (book === "futures" && spec.kind === "rest") {
    const ticker = input.ticker;
    if (input.result !== "success" || ticker?.symbol !== KRAKEN_FUTURES_SYMBOL || !finite(ticker.bid) || !finite(ticker.ask) || !finite(ticker.last)) return null;
    return [
      row("symbol", ticker.symbol, "Futures product"),
      row("bid", ticker.bid, "Best bid"),
      row("ask", ticker.ask, "Best ask"),
      row("last", ticker.last, "Last trade price"),
      ...(finite(ticker.index) ? [row("index", ticker.index, "Index price")] : []),
    ];
  }
  if (book === "spot" && input.channel !== spec.channel) return null;
  if (book === "spot") {
    const item = input.data?.[0];
    if (item?.symbol !== KRAKEN_SPOT_SYMBOL) return null;
    if (spec.channel === "ticker" && finite(item.bid) && finite(item.ask) && finite(item.last)) {
      return [row("symbol", item.symbol, "Spot symbol"), row("bid", item.bid, "Best bid"), row("ask", item.ask, "Best ask"), row("last", item.last, "Last trade price")];
    }
    if (spec.channel === "trade" && finite(item.price) && finite(item.qty)) {
      return [row("symbol", item.symbol, "Spot symbol"), row("price", item.price, "Trade price"), row("qty", item.qty, "Trade size"), row("side", item.side, "Taker side")];
    }
    if (spec.channel === "book" && finite(item.bids?.[0]?.price) && finite(item.asks?.[0]?.price)) {
      return [
        row("symbol", item.symbol, "Spot symbol"),
        row("bid", item.bids[0].price, "Best bid"),
        row("bid size", item.bids[0].qty, "Best bid size"),
        row("ask", item.asks[0].price, "Best ask"),
        row("ask size", item.asks[0].qty, "Best ask size"),
      ];
    }
  }
  if (book === "futures" && input.feed === "ticker" && input.product_id === KRAKEN_FUTURES_SYMBOL && finite(input.bid) && finite(input.ask)) {
    return [
      row("product_id", input.product_id, "Futures product"),
      row("bid", input.bid, "Best bid"),
      row("ask", input.ask, "Best ask"),
      row("last", input.last, "Last trade price"),
      ...(finite(input.index) ? [row("index", input.index, "Index price")] : []),
      ...(finite(input.funding_rate) ? [row("funding_rate", input.funding_rate, "Funding rate")] : []),
    ];
  }
  return null;
}
