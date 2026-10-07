const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const OKX_REST_ORIGIN = "https://www.okx.com";
export const OKX_PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";
export const OKX_TICKER_PATH = "/api/v5/market/ticker";

const MEANING = Object.freeze({
  instId: "Instrument id",
  instType: "SPOT or SWAP",
  last: "Last trade price",
  lastSz: "Last trade size",
  bidPx: "Best bid price",
  bidSz: "Best bid size",
  askPx: "Best ask price",
  askSz: "Best ask size",
  ts: "Exchange timestamp, milliseconds",
  seqId: "Sequence id",
  tradeId: "Trade id",
  px: "Trade price",
  sz: "Trade size",
  side: "Taker side",
  count: "Aggregated match count",
  fundingRate: "Current funding rate",
  fundingTime: "Current funding time",
  nextFundingTime: "Next funding time",
  premium: "Premium used in the funding formula",
  interestRate: "Interest rate component",
});

function connection(id, book, kind, channel, instId) {
  const where = `Admin · OKX ${book} · ${id}`;
  return Object.freeze({
    id,
    book,
    kind,
    channel,
    instId,
    where,
    request: kind === "rest"
      ? `GET ${OKX_TICKER_PATH}?instId=${instId}`
      : JSON.stringify({ op: "subscribe", args: [{ channel, instId }] }),
    address: kind === "rest" ? `${OKX_REST_ORIGIN}${OKX_TICKER_PATH}?instId=${instId}` : OKX_PUBLIC_WS,
  });
}

export const OKX_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "tickers", "BTC-USDT"),
  connection("ws-tickers", "spot", "ws", "tickers", "BTC-USDT"),
  connection("ws-books5", "spot", "ws", "books5", "BTC-USDT"),
  connection("ws-trades", "spot", "ws", "trades", "BTC-USDT"),
]);

export const OKX_SWAP_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "swap", "rest", "tickers", "BTC-USDT-SWAP"),
  connection("ws-tickers", "swap", "ws", "tickers", "BTC-USDT-SWAP"),
  connection("ws-books5", "swap", "ws", "books5", "BTC-USDT-SWAP"),
  connection("ws-funding", "swap", "ws", "funding-rate", "BTC-USDT-SWAP"),
]);

export const OKX_CONDITIONS = Object.freeze([
  "Public market data only. The private socket wss://ws.okx.com:8443/ws/v5/private is not opened.",
  "WebSocket connect limit on this host is 3 new connections per second per IP.",
  "This page opens one connection at a time, and only after that connection is clicked.",
  "The page sends the text frame ping every 20 seconds. The text frame pong is ignored.",
  "A frame for another instrument or channel is ignored. It is not shown as this connection's data.",
  "REST code must be 0. Any other code is an error.",
]);

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function row(field, value) {
  return { field, value: String(value), meaning: MEANING[field] ?? "OKX sent this field. This page stores it only for display." };
}

function fromTicker(item) {
  if (!item || typeof item !== "object") return null;
  if (!decimal(item.last) || !decimal(item.bidPx) || !decimal(item.askPx)) return null;
  return ["instId", "instType", "last", "lastSz", "bidPx", "bidSz", "askPx", "askSz", "ts"].flatMap((field) => (
    item[field] == null ? [] : [row(field, item[field])]
  ));
}

function level(name, levelRow) {
  if (!Array.isArray(levelRow) || !decimal(levelRow[0]) || !decimal(levelRow[1])) return null;
  return [
    { field: `${name} price`, value: levelRow[0], meaning: `Best ${name}` },
    { field: `${name} size`, value: levelRow[1], meaning: `Best ${name} size` },
  ];
}

export function explainOkx(connectionId, book, input) {
  const list = book === "spot" ? OKX_SPOT_CONNECTIONS : OKX_SWAP_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.kind === "rest") {
    if (input.code !== "0" || !Array.isArray(input.data)) return null;
    const rows = fromTicker(input.data[0]);
    if (!rows || input.data[0].instId !== spec.instId) return null;
    return rows;
  }
  const arg = input.arg;
  if (!arg || arg.channel !== spec.channel || arg.instId !== spec.instId || !Array.isArray(input.data)) return null;
  const item = input.data[0];
  if (spec.channel === "tickers" || spec.channel === "funding-rate") {
    if (spec.channel === "tickers") return fromTicker(item);
    if (!item || !decimal(item.fundingRate)) return null;
    return ["instId", "fundingRate", "fundingTime", "nextFundingTime", "premium", "interestRate"].flatMap((field) => (
      item[field] == null || item[field] === "" ? [] : [row(field, item[field])]
    ));
  }
  if (spec.channel === "books5") {
    const bid = level("bid", item?.bids?.[0]);
    const ask = level("ask", item?.asks?.[0]);
    if (!bid || !ask || item.instId !== spec.instId) return null;
    return [...bid, ...ask, row("ts", item.ts), row("seqId", item.seqId)];
  }
  if (spec.channel === "trades") {
    if (!item || item.instId !== spec.instId || !decimal(item.px) || !decimal(item.sz)) return null;
    return ["tradeId", "px", "sz", "side", "ts", "count"].flatMap((field) => (
      item[field] == null ? [] : [row(field, item[field])]
    ));
  }
  return null;
}
