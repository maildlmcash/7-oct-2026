export const MEXC_SPOT_ORIGIN = "https://api.mexc.com";
export const MEXC_FUTURES_ORIGIN = "https://contract.mexc.com";
export const MEXC_SPOT_WS = "wss://wbs-api.mexc.com/ws";
export const MEXC_FUTURES_WS = "wss://contract.mexc.com/edge";
export const MEXC_SPOT_SYMBOL = "BTCUSDT";
export const MEXC_FUTURES_SYMBOL = "BTC_USDT";

function price(value) {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value));
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · MEXC ${book} · ${id}` });
}

export const MEXC_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-book", "spot", "rest", "bookTicker", "GET /api/v3/ticker/bookTicker?symbol=BTCUSDT", `${MEXC_SPOT_ORIGIN}/api/v3/ticker/bookTicker?symbol=BTCUSDT`),
  connection("rest-ticker", "spot", "rest", "24hr", "GET /api/v3/ticker/24hr?symbol=BTCUSDT", `${MEXC_SPOT_ORIGIN}/api/v3/ticker/24hr?symbol=BTCUSDT`),
  connection("ws-book", "spot", "ws", "bookTicker", JSON.stringify({ method: "SUBSCRIPTION", params: ["spot@public.bookTicker.v3.api@BTCUSDT"] }), MEXC_SPOT_WS),
]);

export const MEXC_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /api/v1/contract/ticker?symbol=BTC_USDT", `${MEXC_FUTURES_ORIGIN}/api/v1/contract/ticker?symbol=BTC_USDT`),
  connection("rest-funding", "futures", "rest", "funding", "GET /api/v1/contract/funding_rate/BTC_USDT", `${MEXC_FUTURES_ORIGIN}/api/v1/contract/funding_rate/BTC_USDT`),
  connection("ws-ticker", "futures", "ws", "sub.ticker", JSON.stringify({ method: "sub.ticker", param: { symbol: "BTC_USDT" } }), MEXC_FUTURES_WS),
  connection("ws-depth", "futures", "ws", "sub.depth.full", JSON.stringify({ method: "sub.depth.full", param: { symbol: "BTC_USDT", limit: 5 } }), MEXC_FUTURES_WS),
]);

export const MEXC_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is BTCUSDT.",
  "No API key and no order route.",
  "If the websocket answers Blocked, that error is shown. It is not replaced with futures data.",
]);

export const MEXC_FUTURE_CONDITIONS = Object.freeze([
  "Public futures only. Contract is BTC_USDT.",
  "No API key and no order route.",
  "This page sends {\"method\":\"ping\"} every 15 seconds.",
]);

export function explainMexc(connectionId, book, input) {
  const list = book === "spot" ? MEXC_SPOT_CONNECTIONS : MEXC_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (book === "spot" && spec.kind === "rest") {
    if (input.symbol !== MEXC_SPOT_SYMBOL || !price(input.bidPrice) || !price(input.askPrice)) return null;
    return [row("symbol", input.symbol, "Spot symbol"), row("bidPrice", input.bidPrice, "Best bid"), row("askPrice", input.askPrice, "Best ask"), ...(price(input.lastPrice) ? [row("lastPrice", input.lastPrice, "Last price")] : [])];
  }
  if (book === "futures" && spec.kind === "rest" && spec.channel === "ticker") {
    const data = input.data;
    if (input.success !== true || data?.symbol !== MEXC_FUTURES_SYMBOL || !price(data.lastPrice) || !price(data.bid1)) return null;
    return [row("symbol", data.symbol, "Futures contract"), row("bid1", data.bid1, "Best bid"), row("ask1", data.ask1, "Best ask"), row("lastPrice", data.lastPrice, "Last price")];
  }
  if (book === "futures" && spec.channel === "funding") {
    const data = input.data;
    if (input.success !== true || data?.symbol !== MEXC_FUTURES_SYMBOL || typeof data.fundingRate !== "number") return null;
    return [row("symbol", data.symbol, "Futures contract"), row("fundingRate", data.fundingRate, "Funding rate"), row("nextSettleTime", data.nextSettleTime, "Next settle time")];
  }
  if (book === "futures" && input.symbol === MEXC_FUTURES_SYMBOL && spec.channel === "sub.ticker" && price(input.data?.lastPrice) && price(input.data?.bid1)) {
    return [row("symbol", input.symbol, "Futures contract"), row("bid1", input.data.bid1, "Best bid"), row("lastPrice", input.data.lastPrice, "Last price"), row("fairPrice", input.data.fairPrice, "Fair price"), row("indexPrice", input.data.indexPrice, "Index price")];
  }
  if (book === "futures" && input.symbol === MEXC_FUTURES_SYMBOL && spec.channel === "sub.depth.full" && price(input.data?.bids?.[0]?.[0]) && price(input.data?.asks?.[0]?.[0])) {
    return [row("symbol", input.symbol, "Futures contract"), row("bid", input.data.bids[0][0], "Best bid"), row("bid size", input.data.bids[0][1], "Best bid size"), row("ask", input.data.asks[0][0], "Best ask"), row("ask size", input.data.asks[0][1], "Best ask size")];
  }
  return null;
}
