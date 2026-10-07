export const BITGET_ORIGIN = "https://api.bitget.com";
export const BITGET_PUBLIC_WS = "wss://ws.bitget.com/v2/ws/public";
export const BITGET_SYMBOL = "BTCUSDT";

function price(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Bitget ${book} · ${id}` });
}

export const BITGET_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "ticker", "GET /api/v2/spot/market/tickers?symbol=BTCUSDT", `${BITGET_ORIGIN}/api/v2/spot/market/tickers?symbol=BTCUSDT`),
  connection("rest-book", "spot", "rest", "orderbook", "GET /api/v2/spot/market/orderbook?symbol=BTCUSDT&limit=1", `${BITGET_ORIGIN}/api/v2/spot/market/orderbook?symbol=BTCUSDT&limit=1`),
  connection("ws-ticker", "spot", "ws", "ticker", JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "ticker", instId: "BTCUSDT" }] }), BITGET_PUBLIC_WS),
  connection("ws-book", "spot", "ws", "books1", JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "books1", instId: "BTCUSDT" }] }), BITGET_PUBLIC_WS),
]);

export const BITGET_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=BTCUSDT", `${BITGET_ORIGIN}/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=BTCUSDT`),
  connection("ws-ticker", "futures", "ws", "ticker", JSON.stringify({ op: "subscribe", args: [{ instType: "USDT-FUTURES", channel: "ticker", instId: "BTCUSDT" }] }), BITGET_PUBLIC_WS),
]);

export const BITGET_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is BTCUSDT and instType is SPOT.",
  "wss://ws.bitget.com/v2/ws/private is not opened. No API key and no order route.",
  "This page sends the text frame ping every 30 seconds.",
]);

export const BITGET_FUTURE_CONDITIONS = Object.freeze([
  "Public USDT futures only. Symbol is BTCUSDT and instType is USDT-FUTURES.",
  "The private socket is not opened. No API key and no order route.",
  "This page sends the text frame ping every 30 seconds.",
]);

export function explainBitget(connectionId, book, input) {
  const list = book === "spot" ? BITGET_SPOT_CONNECTIONS : BITGET_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (input.code != null && input.code !== "00000") return null;
  if (spec.kind === "rest" && spec.channel === "orderbook") {
    const bid = input.data?.bids?.[0];
    const ask = input.data?.asks?.[0];
    if (!price(bid?.[0]) || !price(ask?.[0])) return null;
    return [row("bid", bid[0], "Best bid"), row("bid size", bid[1], "Best bid size"), row("ask", ask[0], "Best ask"), row("ask size", ask[1], "Best ask size")];
  }
  if (spec.kind === "rest") {
    const ticker = input.data?.[0];
    if (ticker?.symbol !== BITGET_SYMBOL || !price(ticker.lastPr) || !price(ticker.bidPr) || !price(ticker.askPr)) return null;
    if (book === "futures" && !price(ticker.markPrice)) return null;
    return [
      row("symbol", ticker.symbol, book === "spot" ? "Spot symbol" : "Futures symbol"),
      row("bidPr", ticker.bidPr, "Best bid"),
      row("askPr", ticker.askPr, "Best ask"),
      row("lastPr", ticker.lastPr, "Last price"),
      ...(book === "futures" ? [row("markPrice", ticker.markPrice, "Mark price"), row("fundingRate", ticker.fundingRate, "Funding rate")] : []),
    ];
  }
  const expected = book === "spot" ? "SPOT" : "USDT-FUTURES";
  if (input.arg?.instType !== expected || input.arg?.channel !== spec.channel || input.arg?.instId !== BITGET_SYMBOL) return null;
  const item = input.data?.[0];
  if (spec.channel === "books1") {
    const bid = item?.bids?.[0];
    const ask = item?.asks?.[0];
    if (!price(bid?.[0]) || !price(ask?.[0])) return null;
    return [row("bid", bid[0], "Best bid"), row("bid size", bid[1], "Best bid size"), row("ask", ask[0], "Best ask"), row("ask size", ask[1], "Best ask size")];
  }
  if (!item || !price(item.bidPr) || !price(item.askPr) || !price(item.lastPr)) return null;
  return [
    row("instId", item.instId, book === "spot" ? "Spot symbol" : "Futures symbol"),
    row("bidPr", item.bidPr, "Best bid"),
    row("askPr", item.askPr, "Best ask"),
    row("lastPr", item.lastPr, "Last price"),
    ...(book === "futures" && price(item.markPrice) ? [row("markPrice", item.markPrice, "Mark price"), row("fundingRate", item.fundingRate, "Funding rate")] : []),
  ];
}
