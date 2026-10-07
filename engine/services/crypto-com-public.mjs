export const CRYPTO_ORIGIN = "https://api.crypto.com";
export const CRYPTO_PUBLIC_WS = "wss://stream.crypto.com/exchange/v1/market";
export const CRYPTO_SPOT = "BTC_USDT";
export const CRYPTO_PERP = "BTCUSD-PERP";

function price(value) {
  return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function row(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function connection(id, book, kind, channel, request, address) {
  return Object.freeze({ id, book, kind, channel, request, address, where: `Admin · Crypto.com ${book} · ${id}` });
}

const spotChannels = (name) => JSON.stringify({ id: 1, method: "subscribe", params: { channels: [name] } });

export const CRYPTO_SPOT_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "spot", "rest", "ticker", "GET /exchange/v1/public/get-tickers?instrument_name=BTC_USDT", `${CRYPTO_ORIGIN}/exchange/v1/public/get-tickers?instrument_name=BTC_USDT`),
  connection("rest-book", "spot", "rest", "book", "GET /exchange/v1/public/get-book?instrument_name=BTC_USDT&depth=1", `${CRYPTO_ORIGIN}/exchange/v1/public/get-book?instrument_name=BTC_USDT&depth=1`),
  connection("ws-ticker", "spot", "ws", "ticker", spotChannels("ticker.BTC_USDT"), CRYPTO_PUBLIC_WS),
  connection("ws-book", "spot", "ws", "book", spotChannels("book.BTC_USDT.10"), CRYPTO_PUBLIC_WS),
]);

export const CRYPTO_FUTURE_CONNECTIONS = Object.freeze([
  connection("rest-ticker", "futures", "rest", "ticker", "GET /exchange/v1/public/get-tickers?instrument_name=BTCUSD-PERP", `${CRYPTO_ORIGIN}/exchange/v1/public/get-tickers?instrument_name=BTCUSD-PERP`),
  connection("rest-book", "futures", "rest", "book", "GET /exchange/v1/public/get-book?instrument_name=BTCUSD-PERP&depth=1", `${CRYPTO_ORIGIN}/exchange/v1/public/get-book?instrument_name=BTCUSD-PERP&depth=1`),
  connection("rest-funding", "futures", "rest", "funding", "GET /exchange/v1/public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=funding_hist&count=1", `${CRYPTO_ORIGIN}/exchange/v1/public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=funding_hist&count=1`),
  connection("ws-ticker", "futures", "ws", "ticker", spotChannels("ticker.BTCUSD-PERP"), CRYPTO_PUBLIC_WS),
  connection("ws-book", "futures", "ws", "book", spotChannels("book.BTCUSD-PERP.10"), CRYPTO_PUBLIC_WS),
]);

export const CRYPTO_SPOT_CONDITIONS = Object.freeze([
  "Public spot only. Instrument is BTC_USDT.",
  "wss://stream.crypto.com/exchange/v1/user is not opened. No API key and no order route.",
  "A public/heartbeat is answered with public/respond-heartbeat.",
]);

export const CRYPTO_FUTURE_CONDITIONS = Object.freeze([
  "Public perpetual only. Instrument is BTCUSD-PERP.",
  "The user socket is not opened. No API key and no order route.",
  "A public/heartbeat is answered with public/respond-heartbeat.",
]);

function tickerRows(item, expected) {
  if (item?.i !== expected || !price(item.b) || !price(item.k) || !price(item.a)) return null;
  return [row("i", item.i, "Instrument"), row("b", item.b, "Best bid"), row("k", item.k, "Best ask"), row("a", item.a, "Latest trade price")];
}

function bookRows(item) {
  const bid = item?.bids?.[0];
  const ask = item?.asks?.[0];
  if (!price(bid?.[0]) || !price(ask?.[0])) return null;
  return [row("bid", bid[0], "Best bid"), row("bid size", bid[1], "Best bid size"), row("ask", ask[0], "Best ask"), row("ask size", ask[1], "Best ask size")];
}

export function explainCryptoCom(connectionId, book, input) {
  const list = book === "spot" ? CRYPTO_SPOT_CONNECTIONS : CRYPTO_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  const expected = book === "spot" ? CRYPTO_SPOT : CRYPTO_PERP;
  if (!spec || !input || typeof input !== "object" || input.code !== 0) return null;
  if (spec.channel === "funding") {
    const value = input.result?.data?.[0]?.v;
    if (!price(value)) return null;
    return [row("v", value, "Latest funding valuation for BTCUSD-PERP"), row("t", input.result.data[0].t, "Valuation time")];
  }
  if (spec.kind === "rest" && spec.channel === "ticker") return tickerRows(input.result?.data?.[0], expected);
  if (spec.kind === "rest" && spec.channel === "book") return bookRows(input.result?.data?.[0]);
  const result = input.result;
  if (result?.instrument_name !== expected || result.channel !== spec.channel) return null;
  if (spec.channel === "ticker") return tickerRows(result.data?.[0], expected);
  return bookRows(result.data?.[0]);
}
