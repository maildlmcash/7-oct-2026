import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  BINANCE_SPOT_PUBLIC_DOCS,
  SPOT_STREAM_LIFECYCLE,
  createPublicStreamSession,
  parseExchangeInfo,
  parseRecentTrades,
  parseRestBookTicker,
  parseSpotStreamMessage,
  parseSymbolCatalog,
  publicMarketUrl,
  publicSymbolCatalogUrl,
  smokeBestBidOffer,
  spotStreamName,
  spotStreamUrl,
} from "../services/binance-spot-public.mjs";

const tradeStream = {
  e: "trade",
  E: 1672515782136,
  s: "BNBBTC",
  t: 12345,
  p: "0.001",
  q: "100",
  T: 1672515782136,
  m: true,
  M: true,
};

const bookStream = {
  u: 400900217,
  s: "BNBUSDT",
  b: "25.35190000",
  B: "31.21000000",
  a: "25.36520000",
  A: "40.66000000",
};

function fakeTransport() {
  const calls = { connects: [], sends: [], pongs: [], closes: 0 };
  return {
    calls,
    pongOk: true,
    connect(url) {
      calls.connects.push(url);
    },
    send(text) {
      calls.sends.push(JSON.parse(text));
    },
    pong(payload) {
      calls.pongs.push(payload);
      return this.pongOk;
    },
    close() {
      calls.closes += 1;
    },
  };
}

test("schema fixtures keep official trade, book, and instrument fields", () => {
  assert.equal(BINANCE_SPOT_PUBLIC_DOCS.version, "2026-09-18");
  assert.equal(BINANCE_SPOT_PUBLIC_DOCS.checkedAt, "2026-10-06");
  assert.equal(BINANCE_SPOT_PUBLIC_DOCS.venueDocsUrl, "https://developers.binance.com/en/docs");
  assert.equal(BINANCE_SPOT_PUBLIC_DOCS.changelogUrl.startsWith("https://github.com/binance/binance-spot-api-docs/"), true);
  assert.equal(SPOT_STREAM_LIFECYCLE.connectionValid, "24 hours");
  assert.equal(SPOT_STREAM_LIFECYCLE.serverPing, "20 seconds");
  assert.equal(SPOT_STREAM_LIFECYCLE.pongDeadline, "1 minute");

  const named = spotStreamName("BTCUSDT", "trade");
  assert.equal(named.stream, "btcusdt@trade");
  assert.equal(spotStreamName("BTCUSDT", "depth").error, "stream is not allowed");
  const url = spotStreamUrl(["btcusdt@trade", "btcusdt@bookTicker"]);
  assert.equal(
    url.url,
    "wss://data-stream.binance.vision:443/stream?streams=btcusdt@trade/btcusdt@bookTicker",
  );

  const trade = parseSpotStreamMessage(tradeStream);
  assert.equal(trade.kind, "spot-trade");
  assert.deepEqual(trade.event, tradeStream);
  const wrapped = parseSpotStreamMessage({ stream: "bnbbtc@trade", data: tradeStream });
  assert.equal(wrapped.stream, "bnbbtc@trade");
  assert.equal(wrapped.event.p, "0.001");
  assert.equal(parseSpotStreamMessage({ ...tradeStream, p: 0.001 }).error, "trade schema is not allowed");
  assert.equal(parseSpotStreamMessage({ e: "aggTrade", E: 1, s: "BNBBTC" }).error, "stream message is not allowed");

  const book = parseSpotStreamMessage(bookStream);
  assert.equal(book.kind, "spot-book-ticker");
  assert.deepEqual(book.event, bookStream);
  assert.equal(parseSpotStreamMessage({ ...bookStream, b: 25.35 }).error, "book ticker schema is not allowed");

  const restTrades = parseRecentTrades([{
    id: 28457,
    price: "4.00000100",
    qty: "12.00000000",
    quoteQty: "48.000012",
    time: 1499865549590,
    isBuyerMaker: true,
    isBestMatch: true,
  }]);
  assert.equal(restTrades.trades[0].price, "4.00000100");
  assert.equal(restTrades.trades[0].qty, "12.00000000");

  const restBook = parseRestBookTicker({
    symbol: "LTCBTC",
    bidPrice: "4.00000000",
    bidQty: "431.00000000",
    askPrice: "4.00000200",
    askQty: "9.00000000",
  });
  assert.equal(restBook.book.bidPrice, "4.00000000");
  assert.equal(restBook.book.askQty, "9.00000000");

  const info = parseExchangeInfo({
    timezone: "UTC",
    serverTime: 1565246363776,
    symbols: [{
      symbol: "ETHBTC",
      status: "TRADING",
      baseAsset: "ETH",
      baseAssetPrecision: 8,
      quoteAsset: "BTC",
      quoteAssetPrecision: 8,
      isSpotTradingAllowed: true,
    }],
  });
  assert.equal(info.kind, "spot-instrument");
  assert.equal(info.symbols[0].symbol, "ETHBTC");
  assert.equal(info.symbols[0].isSpotTradingAllowed, true);

  const catalogUrl = publicSymbolCatalogUrl();
  assert.equal(catalogUrl.method, "GET");
  assert.equal(catalogUrl.url, "https://data-api.binance.vision/api/v3/exchangeInfo?symbolStatus=TRADING");
  const catalog = parseSymbolCatalog({
    symbols: [
      { symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT", isSpotTradingAllowed: true },
      { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", isSpotTradingAllowed: true },
      { symbol: "ETHBTC", status: "TRADING", baseAsset: "ETH", quoteAsset: "BTC", isSpotTradingAllowed: true },
      { symbol: "SOLUSDT", status: "BREAK", baseAsset: "SOL", quoteAsset: "USDT", isSpotTradingAllowed: true },
      { symbol: "X", status: "TRADING", baseAsset: "X", quoteAsset: "USDT", isSpotTradingAllowed: true },
    ],
  });
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.symbols.map((coin) => coin.symbol), ["BTCUSDT", "ETHUSDT", "ETHBTC"]);

  const order = publicMarketUrl("/api/v3/order", { symbol: "BTCUSDT" });
  assert.equal(order.error, "orders are closed");
  const bookUrl = publicMarketUrl("/api/v3/ticker/bookTicker", { symbol: "BTCUSDT" });
  assert.equal(bookUrl.method, "GET");
  assert.equal(bookUrl.url, "https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=BTCUSDT");
  assert.equal(bookUrl.url.includes("signature"), false);
  assert.equal(bookUrl.url.includes("apiKey"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("reconnect copies the ping and resubscribes after shutdown, close, and 24 hours", () => {
  let clock = 1_000;
  const transport = fakeTransport();
  const session = createPublicStreamSession({
    streams: ["btcusdt@trade", "btcusdt@bookTicker"],
    now: () => clock,
  });
  assert.equal(session.connect(transport).ok, true);
  assert.equal(transport.calls.connects.length, 1);
  assert.deepEqual(transport.calls.sends[0], {
    method: "SUBSCRIBE",
    params: ["btcusdt@trade", "btcusdt@bookTicker"],
    id: 1,
  });

  assert.equal(session.onServerPing("frame-1").pong, "frame-1");
  assert.equal(transport.calls.pongs.at(-1), "frame-1");
  clock += SPOT_STREAM_LIFECYCLE.pongDeadlineMs;
  assert.equal(session.tick(clock).reconnects, 0);
  assert.equal(transport.calls.connects.length, 1);

  transport.pongOk = false;
  session.onServerPing("frame-2");
  assert.equal(session.onUnsolicitedPong().satisfied, false);
  assert.equal(transport.calls.pongs.at(-1), "");
  clock += SPOT_STREAM_LIFECYCLE.pongDeadlineMs;
  assert.equal(session.tick(clock).reason, "pong deadline");
  assert.equal(transport.calls.sends.at(-1).method, "SUBSCRIBE");
  assert.deepEqual(transport.calls.sends.at(-1).params, ["btcusdt@trade", "btcusdt@bookTicker"]);
  assert.equal(transport.calls.sends.at(-1).id, 2);

  transport.pongOk = true;
  const shutdown = session.onMessage({ e: "serverShutdown", E: 1770123456789 });
  assert.equal(shutdown.reason, "serverShutdown");
  assert.equal(transport.calls.sends.at(-1).id, 3);

  const closed = session.onClose();
  assert.equal(closed.reason, "close");
  assert.equal(transport.calls.sends.at(-1).id, 4);

  const openedAt = clock;
  clock = openedAt + SPOT_STREAM_LIFECYCLE.connectionValidMs - 1;
  assert.equal(session.tick(clock).reconnects, 3);
  clock = openedAt + SPOT_STREAM_LIFECYCLE.connectionValidMs;
  assert.equal(session.tick(clock).reason, "24 hours");
  assert.equal(transport.calls.sends.at(-1).method, "SUBSCRIBE");
  assert.equal(JSON.stringify(transport.calls.sends).includes("/api/v3/order"), false);
  assert.equal(session.snapshot().reconnects.at(-1), "24 hours");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("one bounded public book ticker smoke parses and does not place an order", { timeout: 20_000, skip: process.env.RUN_LIVE_MARKET_SMOKE !== "1" ? "set RUN_LIVE_MARKET_SMOKE=1 to verify outbound market connectivity" : false }, async () => {
  const smoke = await smokeBestBidOffer({ symbol: "BTCUSDT", timeoutMs: 10_000 });
  assert.equal(smoke.ok, true);
  assert.equal(smoke.method, "GET");
  assert.equal(smoke.status, 200);
  assert.equal(smoke.url, "https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=BTCUSDT");
  assert.equal(smoke.book.symbol, "BTCUSDT");
  assert.equal(typeof smoke.book.bidPrice, "string");
  assert.equal(typeof smoke.book.askPrice, "string");
  assert.equal(smoke.book.bidPrice.length > 0, true);
  assert.equal(smoke.book.askQty.length > 0, true);
  assert.equal(JSON.stringify(smoke).includes("apiKey"), false);
  assert.equal(JSON.stringify(smoke).includes("signature"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
