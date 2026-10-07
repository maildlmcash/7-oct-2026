export const KUCOIN_SPOT_ORIGIN = "https://api.kucoin.com";
export const KUCOIN_FUTURES_ORIGIN = "https://api-futures.kucoin.com";
export const KUCOIN_SPOT_SYMBOL = "BTC-USDT";
export const KUCOIN_FUTURES_SYMBOL = "XBTUSDTM";

function decimal(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · KuCoin ${book} · ${id}` });
}

export const KUCOIN_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-level1", "spot", "rest", "level1", "GET /api/v1/market/orderbook/level1?symbol=BTC-USDT", `${KUCOIN_SPOT_ORIGIN}/api/v1/market/orderbook/level1?symbol=BTC-USDT`),
  connection("ws-ticker", "spot", "ws", "ticker", JSON.stringify({ type: "subscribe", topic: "/market/ticker:BTC-USDT", response: true }), "wss://ws-api-spot.kucoin.com/"),
]);

export const KUCOIN_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /api/v1/ticker?symbol=XBTUSDTM", `${KUCOIN_FUTURES_ORIGIN}/api/v1/ticker?symbol=XBTUSDTM`),
  connection("rest-funding", "futures", "rest", "funding", "GET /api/v1/funding-rate/XBTUSDTM/current", `${KUCOIN_FUTURES_ORIGIN}/api/v1/funding-rate/XBTUSDTM/current`),
  connection("ws-ticker", "futures", "ws", "tickerV2", JSON.stringify({ type: "subscribe", topic: "/contractMarket/tickerV2:XBTUSDTM", response: true }), "wss://ws-api-futures.kucoin.com/"),
]);

export const KUCOIN_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is BTC-USDT.",
  "The websocket token comes from POST /api/v1/bullet-public. It is not an API key.",
  "Private bullet-private is not called. No order route is opened.",
  "The page pings on the interval returned by bullet-public.",
]);

export const KUCOIN_FUTURE_CONDITIONS = Object.freeze([
  "Public futures only. Contract is XBTUSDTM.",
  "The websocket token comes from the futures POST /api/v1/bullet-public. It is not an API key.",
  "No order route is opened.",
]);

export function explainKucoin(connectionId, book, input) {
  const list = book === "spot" ? KUCOIN_SPOT_CONNECTIONS : KUCOIN_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object" || input.code != null && input.code !== "200000") return null;
  const data = input.data ?? input;
  if (spec.channel === "level1") {
    if (!decimal(data.bestBid) || !decimal(data.bestAsk) || !decimal(data.price)) return null;
    return [row("bestBid", data.bestBid, "Best bid"), row("bestAsk", data.bestAsk, "Best ask"), row("price", data.price, "Last price"), row("sequence", data.sequence, "Sequence")];
  }
  if (spec.channel === "ticker" && book === "futures" && spec.kind === "rest") {
    if (data.symbol !== KUCOIN_FUTURES_SYMBOL || !decimal(data.price) || !decimal(data.bestBidPrice)) return null;
    return [row("symbol", data.symbol, "Contract"), row("price", data.price, "Last price"), row("bestBidPrice", data.bestBidPrice, "Best bid"), row("bestAskPrice", data.bestAskPrice, "Best ask")];
  }
  if (spec.channel === "funding") {
    if (typeof data.value !== "number" || !Number.isFinite(data.value)) return null;
    return [row("value", data.value, "Current funding rate"), row("granularity", data.granularity, "Funding window in milliseconds")];
  }
  if (spec.kind !== "ws" || input.type !== "message") return null;
  if (book === "spot" && input.topic === "/market/ticker:BTC-USDT" && decimal(data.bestBid) && decimal(data.bestAsk)) {
    return [row("bestBid", data.bestBid, "Best bid"), row("bestAsk", data.bestAsk, "Best ask"), row("price", data.price, "Last price")];
  }
  if (book === "futures" && input.topic === "/contractMarket/tickerV2:XBTUSDTM" && data.symbol === KUCOIN_FUTURES_SYMBOL && decimal(data.bestBidPrice)) {
    return [row("symbol", data.symbol, "Contract"), row("bestBidPrice", data.bestBidPrice, "Best bid"), row("bestAskPrice", data.bestAskPrice, "Best ask")];
  }
  return null;
}
