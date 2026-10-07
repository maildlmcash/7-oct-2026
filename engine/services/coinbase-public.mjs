const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const COINBASE_REST_ORIGIN = "https://api.coinbase.com";
export const COINBASE_PUBLIC_WS = "wss://advanced-trade-ws.coinbase.com";
export const COINBASE_BOOK_PATH = "/api/v3/brokerage/market/product_book";
export const COINBASE_SPOT_PRODUCT = "BTC-USD";
export const COINBASE_FUTURE_PRODUCT = "BIP-20DEC30-CDE";

const MEANING = Object.freeze({
  product_id: "Product id",
  price: "Price",
  size: "Size",
  side: "Taker side",
  trade_id: "Trade id",
  time: "Exchange time",
  best_bid: "Best bid",
  best_ask: "Best ask",
  best_bid_quantity: "Best bid size",
  best_ask_quantity: "Best ask size",
  "bid price": "Best bid",
  "bid size": "Best bid size",
  open: "Candle open",
  high: "Candle high",
  low: "Candle low",
  close: "Candle close",
  volume: "Candle volume",
  volume_24h: "24 hour volume",
  price_level: "Book price level",
  new_quantity: "Book size at that price",
});

function connection(id, book, kind, channel, productId) {
  const restPath = channel === "product_book"
    ? `${COINBASE_BOOK_PATH}?product_id=${productId}&limit=1`
    : channel === "candles"
      ? `/api/v3/brokerage/market/products/${productId}/candles?granularity=ONE_MINUTE`
      : channel === "product"
        ? `/api/v3/brokerage/market/products/${productId}`
        : `/api/v3/brokerage/market/products/${productId}/ticker`;
  const request = kind === "rest"
    ? `GET ${restPath}`
    : JSON.stringify({ type: "subscribe", product_ids: [productId], channel });
  return Object.freeze({
    id,
    book,
    kind,
    channel,
    messageChannel: channel === "level2" ? "l2_data" : channel,
    productId,
    request,
    address: kind === "rest" ? `${COINBASE_REST_ORIGIN}${restPath}` : COINBASE_PUBLIC_WS,
    where: `Admin · Coinbase ${book} · ${id}`,
  });
}

function publicConnections(book, productId) {
  return Object.freeze([
    connection("rest-book", book, "rest", "product_book", productId),
    connection("rest-ticker", book, "rest", "ticker", productId),
    connection("rest-product", book, "rest", "product", productId),
    connection("rest-candles", book, "rest", "candles", productId),
    connection("ws-ticker", book, "ws", "ticker", productId),
    connection("ws-ticker-batch", book, "ws", "ticker_batch", productId),
    connection("ws-trades", book, "ws", "market_trades", productId),
    connection("ws-level2", book, "ws", "level2", productId),
    connection("ws-candles", book, "ws", "candles", productId),
  ]);
}

export const COINBASE_SPOT_CONNECTIONS = publicConnections("spot", COINBASE_SPOT_PRODUCT);
export const COINBASE_FUTURE_CONNECTIONS = publicConnections("futures", COINBASE_FUTURE_PRODUCT);

export const COINBASE_SPOT_CONDITIONS = Object.freeze([
  "Public Advanced Trade spot only. Product is BTC-USD.",
  "wss://advanced-trade-ws-user.coinbase.com is not opened. No API key and no order route.",
  "A websocket also subscribes to heartbeats so the socket stays open. Heartbeat frames are not shown as prices.",
  "A frame for another product is ignored.",
  "Only the first bid and the first ask in a level2 frame are shown. The rest of the ladder is not stored.",
]);

export const COINBASE_FUTURE_CONDITIONS = Object.freeze([
  "Public Advanced Trade futures only. Product is BIP-20DEC30-CDE, the nano Bitcoin perp checked on 2026-10-07.",
  "wss://advanced-trade-ws-user.coinbase.com is not opened. No API key and no order route.",
  "A websocket also subscribes to heartbeats so the socket stays open. Heartbeat frames are not shown as prices.",
  "A frame for another product is ignored.",
  "Only the first bid and the first ask in a level2 frame are shown. The rest of the ladder is not stored.",
]);

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function row(field, value) {
  return { field, value: String(value), meaning: MEANING[field] ?? "Coinbase sent this field. This page stores it only for display." };
}

function tickerRows(ticker, productId) {
  if (ticker?.product_id !== productId || !decimal(ticker.price)) return null;
  return ["product_id", "price", "best_bid", "best_bid_quantity", "best_ask", "best_ask_quantity"].flatMap((field) => (
    ticker[field] == null || ticker[field] === "" ? [] : [row(field, ticker[field])]
  ));
}

function candleRows(candle, productId) {
  if (!candle || (candle.product_id != null && candle.product_id !== productId)) return null;
  if (!decimal(candle.open) || !decimal(candle.high) || !decimal(candle.low) || !decimal(candle.close)) return null;
  return ["product_id", "open", "high", "low", "close", "volume", "start"].flatMap((field) => (
    candle[field] == null || candle[field] === "" ? [] : [row(field, candle[field])]
  ));
}

export function explainCoinbase(connectionId, book, input) {
  const list = book === "spot" ? COINBASE_SPOT_CONNECTIONS : COINBASE_FUTURE_CONNECTIONS;
  const spec = list.find((item) => item.id === connectionId);
  if (!spec || !input || typeof input !== "object") return null;
  if (spec.kind === "rest" && spec.channel === "product_book") {
    const pricebook = input.pricebook;
    const bid = pricebook?.bids?.[0];
    const ask = pricebook?.asks?.[0];
    if (pricebook?.product_id !== spec.productId || !decimal(bid?.price) || !decimal(ask?.price)) return null;
    return [
      row("product_id", pricebook.product_id),
      { field: "bid price", value: bid.price, meaning: "Best bid" },
      { field: "bid size", value: bid.size, meaning: "Best bid size" },
      { field: "ask price", value: ask.price, meaning: "Best ask" },
      { field: "ask size", value: ask.size, meaning: "Best ask size" },
      row("time", pricebook.time),
    ];
  }
  if (spec.kind === "rest" && spec.channel === "ticker") {
    const trade = input.trades?.[0];
    if (trade?.product_id !== spec.productId || !decimal(trade.price) || !decimal(trade.size)) return null;
    return ["product_id", "trade_id", "price", "size", "side", "time"].flatMap((field) => (
      trade[field] == null || trade[field] === "" ? [] : [row(field, trade[field])]
    ));
  }
  if (spec.kind === "rest" && spec.channel === "product") {
    if (input.product_id !== spec.productId || !decimal(input.price)) return null;
    return ["product_id", "price", "volume_24h"].flatMap((field) => (
      input[field] == null || input[field] === "" ? [] : [row(field, input[field])]
    ));
  }
  if (spec.kind === "rest" && spec.channel === "candles") return candleRows(input.candles?.[0], spec.productId);
  if (spec.kind !== "ws" || input.channel !== spec.messageChannel) return null;
  if (spec.channel === "ticker" || spec.channel === "ticker_batch") {
    return tickerRows(input.events?.[0]?.tickers?.[0], spec.productId);
  }
  if (spec.channel === "candles") return candleRows(input.events?.[0]?.candles?.[0], spec.productId);
  if (spec.channel === "level2") {
    const event = input.events?.[0];
    if (event?.product_id !== spec.productId || !Array.isArray(event.updates)) return null;
    const bid = event.updates.find((item) => item.side === "bid" && decimal(item.price_level) && decimal(item.new_quantity));
    const ask = event.updates.find((item) => (item.side === "offer" || item.side === "ask") && decimal(item.price_level) && decimal(item.new_quantity));
    if (!bid && !ask) return null;
    return [
      row("product_id", event.product_id),
      ...(bid ? [{ field: "bid price", value: bid.price_level, meaning: "Best bid in this frame" }, { field: "bid size", value: bid.new_quantity, meaning: "Bid size in this frame" }] : []),
      ...(ask ? [{ field: "ask price", value: ask.price_level, meaning: "Best ask in this frame" }, { field: "ask size", value: ask.new_quantity, meaning: "Ask size in this frame" }] : []),
    ];
  }
  const trade = input.events?.[0]?.trades?.[0];
  if (trade?.product_id !== spec.productId || !decimal(trade.price) || !decimal(trade.size)) return null;
  return ["product_id", "trade_id", "price", "size", "side", "time"].flatMap((field) => (
    trade[field] == null || trade[field] === "" ? [] : [row(field, trade[field])]
  ));
}
