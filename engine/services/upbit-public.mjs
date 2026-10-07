export const UPBIT_ORIGIN = "https://api.upbit.com";
export const UPBIT_PUBLIC_WS = "wss://api.upbit.com/websocket/v1";
export const UPBIT_MARKET = "KRW-BTC";

function price(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, kind, channel, request, address) {
  return Object.freeze({ id, book: "spot", kind, channel, request, address, where: `Admin · Upbit spot · ${id}` });
}

export const UPBIT_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "rest", "ticker", "GET /v1/ticker?markets=KRW-BTC", `${UPBIT_ORIGIN}/v1/ticker?markets=KRW-BTC`),
  connection("rest-book", "rest", "orderbook", "GET /v1/orderbook?markets=KRW-BTC", `${UPBIT_ORIGIN}/v1/orderbook?markets=KRW-BTC`),
  connection("ws-ticker", "ws", "ticker", JSON.stringify([{ ticket: "desk" }, { type: "ticker", codes: ["KRW-BTC"] }]), UPBIT_PUBLIC_WS),
  connection("ws-book", "ws", "orderbook", JSON.stringify([{ ticket: "desk" }, { type: "orderbook", codes: ["KRW-BTC"] }]), UPBIT_PUBLIC_WS),
]);

export const UPBIT_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Market is KRW-BTC. USDT-BTC is not this connection.",
  "Upbit does not publish a public BTC futures book. Futures stays an error.",
  "No API key and no order route.",
]);

function bookRows(unit, market) {
  if (market !== UPBIT_MARKET || !price(unit?.bid_price) || !price(unit?.ask_price)) return null;
  return [row("market", market, "Spot market"), row("bid_price", unit.bid_price, "Best bid"), row("ask_price", unit.ask_price, "Best ask")];
}

export function explainUpbit(connectionId, input) {
  const spec = UPBIT_SPOT_CONNECTIONS.find((item) => item.id === connectionId);
  if (!spec || input == null) return null;
  const body = Array.isArray(input) ? input[0] : input;
  if (!body || typeof body !== "object") return null;
  if (spec.channel === "ticker" && spec.kind === "rest") {
    if (body.market !== UPBIT_MARKET || !price(body.trade_price)) return null;
    return [row("market", body.market, "Spot market"), row("trade_price", body.trade_price, "Last trade price")];
  }
  if (spec.channel === "orderbook" && spec.kind === "rest") return bookRows(body.orderbook_units?.[0], body.market);
  if (body.code !== UPBIT_MARKET || body.type !== spec.channel) return null;
  if (spec.channel === "ticker" && price(body.trade_price)) return [row("code", body.code, "Spot market"), row("trade_price", body.trade_price, "Last trade price")];
  return bookRows(body.orderbook_units?.[0], body.code);
}
