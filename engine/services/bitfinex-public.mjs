export const BITFINEX_ORIGIN = "https://api-pub.bitfinex.com";
export const BITFINEX_PUBLIC_WS = "wss://api-pub.bitfinex.com/ws/2";
export const BITFINEX_SPOT = "tBTCUSD";
export const BITFINEX_PERP = "tBTCF0:USTF0";

function price(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Bitfinex ${book} · ${id}` });
}

export const BITFINEX_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "ticker", "GET /v2/ticker/tBTCUSD", `${BITFINEX_ORIGIN}/v2/ticker/tBTCUSD`),
  connection("rest-book", "spot", "rest", "book", "GET /v2/book/tBTCUSD/P0?len=1", `${BITFINEX_ORIGIN}/v2/book/tBTCUSD/P0?len=1`),
  connection("ws-ticker", "spot", "ws", "ticker", JSON.stringify({ event: "subscribe", channel: "ticker", symbol: "tBTCUSD" }), BITFINEX_PUBLIC_WS),
  connection("ws-book", "spot", "ws", "book", JSON.stringify({ event: "subscribe", channel: "book", symbol: "tBTCUSD", prec: "P0", freq: "F0", len: "1" }), BITFINEX_PUBLIC_WS),
]);

export const BITFINEX_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /v2/ticker/tBTCF0:USTF0", `${BITFINEX_ORIGIN}/v2/ticker/${encodeURIComponent(BITFINEX_PERP)}`),
  connection("rest-status", "futures", "rest", "deriv", "GET /v2/status/deriv?keys=tBTCF0:USTF0", `${BITFINEX_ORIGIN}/v2/status/deriv?keys=${encodeURIComponent(BITFINEX_PERP)}`),
  connection("ws-ticker", "futures", "ws", "ticker", JSON.stringify({ event: "subscribe", channel: "ticker", symbol: "tBTCF0:USTF0" }), BITFINEX_PUBLIC_WS),
]);

export const BITFINEX_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Symbol is tBTCUSD.",
  "wss://api.bitfinex.com/ws/2 is not opened. No API key and no order route.",
  "This page sends {\"event\":\"ping\"} every 20 seconds. A heartbeat frame is not a price.",
]);

export const BITFINEX_FUTURE_CONDITIONS = Object.freeze([
  "Public perpetual only. Symbol is tBTCF0:USTF0.",
  "The authenticated socket is not opened. No API key and no order route.",
  "This page sends {\"event\":\"ping\"} every 20 seconds.",
]);

function tickerRows(values, label) {
  if (!Array.isArray(values) || !price(values[0]) || !price(values[2]) || !price(values[6])) return null;
  return [row("symbol", label, "Subscribed symbol"), row("bid", values[0], "Best bid"), row("ask", values[2], "Best ask"), row("last", values[6], "Last price")];
}

function bookRows(levels) {
  if (!Array.isArray(levels)) return null;
  const bid = levels.find((level) => Array.isArray(level) && price(level[0]) && level[2] > 0);
  const ask = levels.find((level) => Array.isArray(level) && price(level[0]) && level[2] < 0);
  if (!bid || !ask) return null;
  return [row("bid", bid[0], "Best bid"), row("bid size", bid[2], "Bid amount"), row("ask", ask[0], "Best ask"), row("ask size", Math.abs(ask[2]), "Ask amount")];
}

export function explainBitfinex(connectionId, book, input) {
  const list = book === "spot" ? BITFINEX_SPOT_CONNECTIONS : BITFINEX_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  const label = book === "spot" ? BITFINEX_SPOT : BITFINEX_PERP;
  if (!spec || input == null) return null;
  if (spec.channel === "deriv") {
    const status = Array.isArray(input?.[0]) ? input[0] : null;
    if (status?.[0] !== BITFINEX_PERP || !price(status[15]) || !price(status[12])) return null;
    return [row("KEY", status[0], "Perpetual symbol"), row("MARK_PRICE", status[15], "Mark price"), row("CURRENT_FUNDING", status[12], "Current funding")];
  }
  if (spec.channel === "book" && spec.kind === "rest") return bookRows(input);
  if (!Array.isArray(input)) return null;
  if (spec.channel === "ticker" && spec.kind === "rest") return tickerRows(input, label);
  if (typeof input[0] !== "number") return null;
  if (spec.channel === "ticker") return tickerRows(input[1], label);
  if (spec.channel === "book" && Array.isArray(input[1]?.[0])) return bookRows(input[1]);
  return null;
}
