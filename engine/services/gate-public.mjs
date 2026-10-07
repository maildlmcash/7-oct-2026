export const GATE_ORIGIN = "https://api.gateio.ws";
export const GATE_SPOT_WS = "wss://api.gateio.ws/ws/v4/";
export const GATE_FUTURES_WS = "wss://fx-ws.gateio.ws/v4/ws/usdt";
export const GATE_PAIR = "BTC_USDT";

function price(value) {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value));
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Gate ${book} · ${id}` });
}

export const GATE_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "tickers", "GET /api/v4/spot/tickers?currency_pair=BTC_USDT", `${GATE_ORIGIN}/api/v4/spot/tickers?currency_pair=BTC_USDT`),
  connection("rest-book", "spot", "rest", "order_book", "GET /api/v4/spot/order_book?currency_pair=BTC_USDT&limit=1", `${GATE_ORIGIN}/api/v4/spot/order_book?currency_pair=BTC_USDT&limit=1`),
  connection("ws-book", "spot", "ws", "spot.book_ticker", JSON.stringify({ channel: "spot.book_ticker", event: "subscribe", payload: ["BTC_USDT"] }), GATE_SPOT_WS),
  connection("ws-ticker", "spot", "ws", "spot.tickers", JSON.stringify({ channel: "spot.tickers", event: "subscribe", payload: ["BTC_USDT"] }), GATE_SPOT_WS),
]);

export const GATE_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "tickers", "GET /api/v4/futures/usdt/tickers?contract=BTC_USDT", `${GATE_ORIGIN}/api/v4/futures/usdt/tickers?contract=BTC_USDT`),
  connection("ws-ticker", "futures", "ws", "futures.tickers", JSON.stringify({ channel: "futures.tickers", event: "subscribe", payload: ["BTC_USDT"] }), GATE_FUTURES_WS),
  connection("ws-book", "futures", "ws", "futures.book_ticker", JSON.stringify({ channel: "futures.book_ticker", event: "subscribe", payload: ["BTC_USDT"] }), GATE_FUTURES_WS),
]);

export const GATE_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Pair is BTC_USDT.",
  "No API key and no order channel.",
  "This page sends spot.ping every 20 seconds.",
]);

export const GATE_FUTURE_CONDITIONS = Object.freeze([
  "Public USDT futures only. Contract is BTC_USDT.",
  "No API key and no order channel.",
  "This page sends futures.ping every 20 seconds.",
]);

export function explainGate(connectionId, book, input) {
  const list = book === "spot" ? GATE_SPOT_CONNECTIONS : GATE_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.kind === "rest" && book === "spot" && spec.channel === "tickers") {
    const ticker = Array.isArray(input) ? input[0] : null;
    if (ticker?.currency_pair !== GATE_PAIR || !price(ticker.last) || !price(ticker.highest_bid) || !price(ticker.lowest_ask)) return null;
    return [row("currency_pair", ticker.currency_pair, "Spot pair"), row("highest_bid", ticker.highest_bid, "Best bid"), row("lowest_ask", ticker.lowest_ask, "Best ask"), row("last", ticker.last, "Last price")];
  }
  if (spec.kind === "rest" && book === "spot" && spec.channel === "order_book") {
    const bid = input.bids?.[0];
    const ask = input.asks?.[0];
    if (!price(bid?.[0]) || !price(ask?.[0])) return null;
    return [row("bid", bid[0], "Best bid"), row("bid size", bid[1], "Best bid size"), row("ask", ask[0], "Best ask"), row("ask size", ask[1], "Best ask size")];
  }
  if (spec.kind === "rest" && book === "futures") {
    const ticker = Array.isArray(input) ? input[0] : null;
    if (ticker?.contract !== GATE_PAIR || !price(ticker.last) || !price(ticker.mark_price)) return null;
    return [row("contract", ticker.contract, "Futures contract"), row("highest_bid", ticker.highest_bid, "Best bid"), row("lowest_ask", ticker.lowest_ask, "Best ask"), row("last", ticker.last, "Last price"), row("mark_price", ticker.mark_price, "Mark price"), row("funding_rate", ticker.funding_rate, "Funding rate")];
  }
  if (input.channel !== spec.channel || input.event !== "update") return null;
  const result = input.result;
  if (spec.channel.endsWith("book_ticker")) {
    if (result?.s !== GATE_PAIR || !price(result.b) || !price(result.a)) return null;
    return [row("s", result.s, book === "spot" ? "Spot pair" : "Futures contract"), row("b", result.b, "Best bid"), row("B", result.B, "Best bid size"), row("a", result.a, "Best ask"), row("A", result.A, "Best ask size")];
  }
  if (book === "spot" && result?.currency_pair === GATE_PAIR && price(result.last)) {
    return [row("currency_pair", result.currency_pair, "Spot pair"), row("highest_bid", result.highest_bid, "Best bid"), row("lowest_ask", result.lowest_ask, "Best ask"), row("last", result.last, "Last price")];
  }
  const ticker = Array.isArray(result) ? result[0] : null;
  if (book === "futures" && ticker?.contract === GATE_PAIR && price(ticker.last) && price(ticker.mark_price)) {
    return [row("contract", ticker.contract, "Futures contract"), row("last", ticker.last, "Last price"), row("mark_price", ticker.mark_price, "Mark price"), row("funding_rate", ticker.funding_rate, "Funding rate")];
  }
  return null;
}
