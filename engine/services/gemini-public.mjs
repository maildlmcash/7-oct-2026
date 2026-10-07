export const GEMINI_ORIGIN = "https://api.gemini.com";
export const GEMINI_STREAM_WS = "wss://ws.gemini.com";
export const GEMINI_SPOT = "btcusd";
export const GEMINI_PERP = "btcgusdperp";

function decimal(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Gemini ${book} · ${id}` });
}

function socket(symbol) {
  return `wss://api.gemini.com/v1/marketdata/${symbol}?heartbeat=true&top_of_book=true`;
}

export const GEMINI_SPOT_CONNECTIONS = Object.freeze([
  connection("ws-depth", "spot", "ws", "depth10@100ms", JSON.stringify({ method: "SUBSCRIBE", params: ["btcusd@depth10@100ms"], id: 1 }), GEMINI_STREAM_WS),
  connection("ws-ticker", "spot", "ws", "bookTicker", JSON.stringify({ method: "SUBSCRIBE", params: ["btcusd@bookTicker"], id: 1 }), GEMINI_STREAM_WS),
  connection("ws-book", "spot", "ws", "marketdata", "The symbol is in the URL. top_of_book=true and heartbeat=true", socket(GEMINI_SPOT)),
  connection("rest-ticker", "spot", "rest", "pubticker", "GET /v1/pubticker/btcusd", `${GEMINI_ORIGIN}/v1/pubticker/btcusd`),
  connection("rest-book", "spot", "rest", "book", "GET /v1/book/btcusd?limit_bids=1&limit_asks=1", `${GEMINI_ORIGIN}/v1/book/btcusd?limit_bids=1&limit_asks=1`),
]);

export const GEMINI_FUTURE_CONNECTIONS = Object.freeze([
  connection("ws-depth", "futures", "ws", "depth10@100ms", JSON.stringify({ method: "SUBSCRIBE", params: ["btcgusdperp@depth10@100ms"], id: 1 }), GEMINI_STREAM_WS),
  connection("ws-ticker", "futures", "ws", "bookTicker", JSON.stringify({ method: "SUBSCRIBE", params: ["btcgusdperp@bookTicker"], id: 1 }), GEMINI_STREAM_WS),
  connection("ws-book", "futures", "ws", "marketdata", "The symbol is in the URL. top_of_book=true and heartbeat=true", socket(GEMINI_PERP)),
  connection("rest-ticker", "futures", "rest", "pubticker", "GET /v1/pubticker/btcgusdperp", `${GEMINI_ORIGIN}/v1/pubticker/btcgusdperp`),
  connection("rest-book", "futures", "rest", "book", "GET /v1/book/btcgusdperp?limit_bids=1&limit_asks=1", `${GEMINI_ORIGIN}/v1/book/btcgusdperp?limit_bids=1&limit_asks=1`),
  connection("rest-funding", "futures", "rest", "funding", "GET /v1/fundingamount/btcgusdperp", `${GEMINI_ORIGIN}/v1/fundingamount/btcgusdperp`),
]);

export const GEMINI_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is btcusd. Depth is the top 10 bids and asks, refreshed about every 100 milliseconds.",
  "wss://api.gemini.com/v1/order/events is not opened. No API key and no order route.",
  "A heartbeat frame is not a price.",
]);

export const GEMINI_FUTURE_CONDITIONS = Object.freeze([
  "Public perpetual only. Symbol is btcgusdperp. Depth is the top 10 bids and asks, refreshed about every 100 milliseconds.",
  "The order socket is not opened. No API key and no order route.",
  "A heartbeat frame is not a price.",
]);

function quote(input, symbol) {
  if (input?.symbol != null && input.symbol !== symbol) return null;
  if (!decimal(input?.bid) || !decimal(input?.ask) || !decimal(input?.last)) return null;
  return [row("symbol", symbol, "Requested symbol"), row("bid", input.bid, "Best bid"), row("ask", input.ask, "Best ask"), row("last", input.last, "Last price")];
}

function book(input, symbol) {
  const bid = input?.bids?.[0];
  const ask = input?.asks?.[0];
  if (!decimal(bid?.price) || !decimal(ask?.price)) return null;
  return [row("symbol", symbol, "Requested symbol"), row("bid", bid.price, "Best bid"), row("ask", ask.price, "Best ask")];
}

export function explainGemini(connectionId, bookName, input) {
  const list = bookName === "spot" ? GEMINI_SPOT_CONNECTIONS : GEMINI_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  const symbol = bookName === "spot" ? GEMINI_SPOT : GEMINI_PERP;
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.channel === "funding") {
    if (input.symbol !== GEMINI_PERP || typeof input.fundingAmount !== "number") return null;
    return [row("symbol", input.symbol, "Perpetual symbol"), row("fundingAmount", input.fundingAmount, "Funding amount"), row("nextFundingTimestamp", input.nextFundingTimestamp, "Next funding time")];
  }
  if (spec.channel === "pubticker") return quote(input, symbol);
  if (spec.kind === "rest") return book(input, symbol);
  if (spec.channel === "depth10@100ms") {
    if (input.symbol !== symbol || !Array.isArray(input.bids) || !Array.isArray(input.asks) || typeof input.lastUpdateId !== "number") return null;
    const levels = (side) => input[side].slice(0, 10).filter((level) => decimal(level?.[0]) && decimal(level?.[1]));
    const bids = levels("bids");
    const asks = levels("asks");
    if (!bids.length || !asks.length) return null;
    return [
      row("symbol", input.symbol, "Socket symbol"),
      row("lastUpdateId", input.lastUpdateId, "Sequence of this depth snapshot"),
      ...bids.map((level, index) => row(`bid ${index + 1}`, `${level[0]} × ${level[1]}`, "Bid price and size")),
      ...asks.map((level, index) => row(`ask ${index + 1}`, `${level[0]} × ${level[1]}`, "Ask price and size")),
    ];
  }
  if (spec.channel === "bookTicker") {
    if (input.s !== symbol || !decimal(input.b) || !decimal(input.a)) return null;
    return [row("s", input.s, "Socket symbol"), row("b", input.b, "Best bid"), row("a", input.a, "Best ask"), ...(decimal(input.c) ? [row("c", input.c, "Last price")] : [])];
  }
  if (input.type === "heartbeat") return null;
  if (input.type !== "update" || !Array.isArray(input.events)) return null;
  const bid = [...input.events].reverse().find((event) => event.side === "bid" && decimal(event.price));
  const ask = [...input.events].reverse().find((event) => event.side === "ask" && decimal(event.price));
  if (!bid && !ask) return null;
  return [
    row("symbol", symbol, "Socket symbol"),
    ...(bid ? [row("bid", bid.price, "Best bid"), row("bid remaining", bid.remaining, "Bid size")] : []),
    ...(ask ? [row("ask", ask.price, "Best ask"), row("ask remaining", ask.remaining, "Ask size")] : []),
  ];
}
