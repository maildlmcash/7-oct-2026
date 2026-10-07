export const BITSTAMP_ORIGIN = "https://www.bitstamp.net";
export const BITSTAMP_PUBLIC_WS = "wss://ws.bitstamp.net";

function decimal(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Bitstamp ${book} · ${id}` });
}

export const BITSTAMP_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "ticker", "GET /api/v2/ticker/btcusd/", `${BITSTAMP_ORIGIN}/api/v2/ticker/btcusd/`),
  connection("rest-book", "spot", "rest", "order_book", "GET /api/v2/order_book/btcusd/", `${BITSTAMP_ORIGIN}/api/v2/order_book/btcusd/`),
  connection("ws-book", "spot", "ws", "order_book_btcusd", JSON.stringify({ event: "bts:subscribe", data: { channel: "order_book_btcusd" } }), BITSTAMP_PUBLIC_WS),
]);

export const BITSTAMP_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /api/v2/ticker/btcusd-perp/", `${BITSTAMP_ORIGIN}/api/v2/ticker/btcusd-perp/`),
  connection("rest-book", "futures", "rest", "order_book", "GET /api/v2/order_book/btcusd-perp/", `${BITSTAMP_ORIGIN}/api/v2/order_book/btcusd-perp/`),
  connection("ws-book", "futures", "ws", "order_book_btcusd-perp", JSON.stringify({ event: "bts:subscribe", data: { channel: "order_book_btcusd-perp" } }), BITSTAMP_PUBLIC_WS),
]);

export const BITSTAMP_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Market is btcusd.",
  "A perpetual frame is rejected here.",
  "No API key and no order route.",
]);

export const BITSTAMP_FUTURE_CONDITIONS = Object.freeze([
  "Public perpetual only. Market is btcusd-perp.",
  "A spot frame is rejected here.",
  "No API key and no order route.",
]);

function top(book) {
  const bid = book?.bids?.[0];
  const ask = book?.asks?.[0];
  if (!decimal(bid?.[0]) || !decimal(ask?.[0])) return null;
  return [row("bid", bid[0], "Best bid"), row("bid size", bid[1], "Best bid size"), row("ask", ask[0], "Best ask"), row("ask size", ask[1], "Best ask size")];
}

export function explainBitstamp(connectionId, book, input) {
  const list = book === "spot" ? BITSTAMP_SPOT_CONNECTIONS : BITSTAMP_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.channel === "ticker") {
    if (!decimal(input.bid) || !decimal(input.ask) || !decimal(input.last)) return null;
    if (book === "spot" && input.mark_price != null) return null;
    if (book === "futures" && !decimal(input.mark_price)) return null;
    return [
      row("bid", input.bid, "Best bid"),
      row("ask", input.ask, "Best ask"),
      row("last", input.last, "Last price"),
      ...(book === "futures" ? [row("mark_price", input.mark_price, "Mark price"), row("index_price", input.index_price, "Index price")] : []),
    ];
  }
  if (spec.kind === "rest") return top(input);
  if (input.event !== "data" || input.channel !== spec.channel) return null;
  return top(input.data);
}
