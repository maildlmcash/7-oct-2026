export const HTX_SPOT_ORIGIN = "https://api.huobi.pro";
export const HTX_FUTURES_ORIGIN = "https://api.hbdm.com";
export const HTX_SPOT_WS = "wss://api.huobi.pro/ws";
export const HTX_FUTURES_WS = "wss://api.hbdm.com/linear-swap-ws";

function price(value) {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value));
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · HTX ${book} · ${id}` });
}

export const HTX_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-merged", "spot", "rest", "merged", "GET /market/detail/merged?symbol=btcusdt", `${HTX_SPOT_ORIGIN}/market/detail/merged?symbol=btcusdt`),
  connection("ws-ticker", "spot", "ws", "ticker", JSON.stringify({ sub: "market.btcusdt.ticker" }), HTX_SPOT_WS),
  connection("ws-bbo", "spot", "ws", "bbo", JSON.stringify({ sub: "market.btcusdt.bbo" }), HTX_SPOT_WS),
]);

export const HTX_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-merged", "futures", "rest", "merged", "GET /linear-swap-ex/market/detail/merged?contract_code=BTC-USDT", `${HTX_FUTURES_ORIGIN}/linear-swap-ex/market/detail/merged?contract_code=BTC-USDT`),
  connection("rest-funding", "futures", "rest", "funding", "GET /linear-swap-api/v1/swap_funding_rate?contract_code=BTC-USDT", `${HTX_FUTURES_ORIGIN}/linear-swap-api/v1/swap_funding_rate?contract_code=BTC-USDT`),
  connection("ws-bbo", "futures", "ws", "bbo", JSON.stringify({ sub: "market.BTC-USDT.bbo" }), HTX_FUTURES_WS),
]);

export const HTX_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is btcusdt.",
  "wss://api.huobi.pro/ws/v2 is not opened. No API key and no order route.",
  "Frames are gzip. The page answers a server ping with the same pong.",
]);

export const HTX_FUTURE_CONDITIONS = Object.freeze([
  "Public linear swap only. Contract is BTC-USDT.",
  "No API key and no order route.",
  "Frames are gzip. The page answers a server ping with the same pong.",
]);

function bookLevel(tick) {
  const bid = Array.isArray(tick?.bid) ? tick.bid[0] : tick?.bid;
  const ask = Array.isArray(tick?.ask) ? tick.ask[0] : tick?.ask;
  return price(bid) && price(ask) ? { bid, ask } : null;
}

export function explainHtx(connectionId, book, input) {
  const list = book === "spot" ? HTX_SPOT_CONNECTIONS : HTX_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object" || input.status === "error") return null;
  if (spec.channel === "funding") {
    if (input.status !== "ok" || input.data?.contract_code !== "BTC-USDT" || !price(input.data.funding_rate)) return null;
    return [row("contract_code", input.data.contract_code, "Futures contract"), row("funding_rate", input.data.funding_rate, "Funding rate")];
  }
  if (spec.kind === "rest") {
    const expected = book === "spot" ? "market.btcusdt.detail.merged" : "market.BTC-USDT.detail.merged";
    const level = bookLevel(input.tick);
    if (input.ch !== expected || input.status !== "ok" || !level) return null;
    return [row("ch", input.ch, book === "spot" ? "Spot symbol" : "Futures contract"), row("bid", level.bid, "Best bid"), row("ask", level.ask, "Best ask"), row("close", input.tick.close, "Last price")];
  }
  const expected = spec.channel === "ticker"
    ? "market.btcusdt.ticker"
    : book === "spot" ? "market.btcusdt.bbo" : "market.BTC-USDT.bbo";
  if (input.ch !== expected) return null;
  const level = bookLevel(input.tick);
  if (!level) return null;
  if (book === "spot" && spec.channel === "bbo" && input.tick.symbol !== "btcusdt") return null;
  return [row("ch", input.ch, book === "spot" ? "Spot symbol" : "Futures contract"), row("bid", level.bid, "Best bid"), row("ask", level.ask, "Best ask")];
}
