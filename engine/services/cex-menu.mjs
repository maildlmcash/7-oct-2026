export const CEX_MENU = Object.freeze([
  Object.freeze({ id: "ws-depth", label: "WebSocket · depth" }),
  Object.freeze({ id: "ws-ticker", label: "WebSocket · ticker" }),
  Object.freeze({ id: "rest-ticker", label: "REST · ticker" }),
  Object.freeze({ id: "rest-book", label: "REST · book" }),
  Object.freeze({ id: "rest-funding", label: "REST · funding", futures: true }),
]);

const COINS = new Set(["BTC", "ETH", "SOL"]);

export function menuItems(book) {
  return CEX_MENU.filter((item) => book === "futures" || !item.futures);
}

function allowed(venue, book, coin) {
  if (!COINS.has(coin)) return false;
  if (book === "futures" && venue === "upbit") return false;
  if (book === "futures" && venue === "coinbase" && coin !== "BTC") return false;
  if (book === "futures" && venue === "kraken" && coin === "SOL") return false;
  if (book === "futures" && venue === "bitfinex" && coin === "SOL") return false;
  return true;
}

function usdt(coin) {
  return `${coin}USDT`;
}

function pair(coin) {
  return `${coin}_USDT`;
}

export function menuCall(venue, book, coin, call) {
  const item = CEX_MENU.find((entry) => entry.id === call);
  if (!item || (item.futures && book !== "futures") || !allowed(venue, book, coin)) {
    return { ok: false, error: "This menu call is not on this book." };
  }
  const symbol = usdt(coin);
  const lower = symbol.toLowerCase();
  const inst = book === "spot" ? `${coin}-USDT` : `${coin}-USDT-SWAP`;
  const ws = (address, request, ping = null) => ({ ok: true, kind: "ws", address, request, ping, symbol });
  const rest = (address) => ({ ok: true, kind: "rest", address, request: `GET ${address}`, ping: null, symbol });
  const missing = { ok: false, error: "This exchange has no public call for this menu item." };

  if (call === "ws-depth" || call === "ws-ticker") {
    const depth = call === "ws-depth";
    if (venue === "binance" && book === "spot") {
      return ws(`wss://data-stream.binance.vision:443/ws/${lower}@${depth ? "depth10@100ms" : "bookTicker"}`, "The stream name is in the URL.");
    }
    if (venue === "binance" && book === "futures") {
      return ws(`wss://fstream.binance.com/public/ws/${lower}@${depth ? "depth10@100ms" : "bookTicker"}`, "The stream name is in the URL.");
    }
    if (venue === "bybit") {
      const topic = depth ? `orderbook.50.${symbol}` : `tickers.${symbol}`;
      return ws(book === "spot" ? "wss://stream.bybit.com/v5/public/spot" : "wss://stream.bybit.com/v5/public/linear", JSON.stringify({ op: "subscribe", args: [topic] }), "bybit");
    }
    if (venue === "okx") {
      return ws("wss://ws.okx.com:8443/ws/v5/public", JSON.stringify({ op: "subscribe", args: [{ channel: depth ? "books5" : "tickers", instId: inst }] }), "text");
    }
    if (venue === "coinbase") {
      const product = book === "futures" ? "BIP-20DEC30-CDE" : `${coin}-USD`;
      return ws("wss://advanced-trade-ws.coinbase.com", JSON.stringify({ type: "subscribe", product_ids: [product], channel: "ticker" }));
    }
    if (venue === "kraken" && book === "spot") {
      const channel = depth ? "book" : "ticker";
      const params = { channel, symbol: [`${coin}/USD`] };
      if (depth) params.depth = 10;
      return ws("wss://ws.kraken.com/v2", JSON.stringify({ method: "subscribe", params }));
    }
    if (venue === "kraken" && book === "futures") {
      if (depth) return missing;
      return ws("wss://futures.kraken.com/ws/v1", JSON.stringify({ event: "subscribe", feed: "ticker", product_ids: [coin === "BTC" ? "PI_XBTUSD" : "PI_ETHUSD"] }));
    }
    if (venue === "kucoin") {
      const topic = book === "spot"
        ? `/market/ticker:${coin}-USDT`
        : `/contractMarket/tickerV2:${coin === "BTC" ? "XBTUSDTM" : `${coin}USDTM`}`;
      return { ok: true, kind: "ws", address: "", request: JSON.stringify({ id: "1", type: "subscribe", topic, response: true }), ping: "kucoin", bullet: book, symbol: topic };
    }
    if (venue === "gate") {
      const channel = book === "spot" ? (depth ? "spot.order_book" : "spot.book_ticker") : (depth ? "futures.order_book" : "futures.book_ticker");
      const payload = depth ? (book === "spot" ? [pair(coin), "5", "100ms"] : [pair(coin), "5", "0"]) : [pair(coin)];
      return ws(book === "spot" ? "wss://api.gateio.ws/ws/v4/" : "wss://fx-ws.gateio.ws/v4/ws/usdt", JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: "subscribe", payload }), "gate");
    }
    if (venue === "bitget") {
      return ws("wss://ws.bitget.com/v2/ws/public", JSON.stringify({ op: "subscribe", args: [{ instType: book === "spot" ? "SPOT" : "USDT-FUTURES", channel: depth ? "books5" : "ticker", instId: symbol }] }), "text");
    }
    if (venue === "mexc" && book === "spot") {
      return depth ? missing : ws("wss://wbs-api.mexc.com/ws", JSON.stringify({ method: "SUBSCRIPTION", params: [`spot@public.bookTicker.v3.api@${symbol}`] }));
    }
    if (venue === "mexc" && book === "futures") {
      return depth
        ? ws("wss://contract.mexc.com/edge", JSON.stringify({ method: "sub.depth.full", param: { symbol: pair(coin), limit: 5 } }), "mexc")
        : ws("wss://contract.mexc.com/edge", JSON.stringify({ method: "sub.ticker", param: { symbol: pair(coin) } }), "mexc");
    }
    if (venue === "htx") {
      const sub = book === "spot"
        ? `market.${lower}.${depth ? "depth.step0" : "ticker"}`
        : `market.${coin}-USDT.${depth ? "depth.step0" : "bbo"}`;
      return ws(book === "spot" ? "wss://api.huobi.pro/ws" : "wss://api.hbdm.com/linear-swap-ws", JSON.stringify({ sub }), "htx");
    }
    if (venue === "crypto-com") {
      const name = book === "spot" ? pair(coin) : `${coin}USD-PERP`;
      return ws("wss://stream.crypto.com/exchange/v1/market", JSON.stringify({ id: 1, method: "subscribe", params: { channels: [`${depth ? "book" : "ticker"}.${name}${depth ? ".10" : ""}`] } }), "crypto");
    }
    if (venue === "upbit") {
      return ws("wss://api.upbit.com/websocket/v1", JSON.stringify([{ ticket: "desk" }, { type: depth ? "orderbook" : "ticker", codes: [`KRW-${coin}`] }]));
    }
    if (venue === "bitfinex") {
      const name = book === "spot" ? `t${coin}USD` : `t${coin === "BTC" ? "BTC" : "ETH"}F0:USTF0`;
      return depth
        ? ws("wss://api-pub.bitfinex.com/ws/2", JSON.stringify({ event: "subscribe", channel: "book", symbol: name, prec: "P0", freq: "F0", len: "25" }), "bitfinex")
        : ws("wss://api-pub.bitfinex.com/ws/2", JSON.stringify({ event: "subscribe", channel: "ticker", symbol: name }), "bitfinex");
    }
    if (venue === "bitstamp") {
      const marketName = `${coin.toLowerCase()}usd${book === "futures" ? "-perp" : ""}`;
      if (!depth) return missing;
      return ws("wss://ws.bitstamp.net", JSON.stringify({ event: "bts:subscribe", data: { channel: `order_book_${marketName}` } }), "bitstamp");
    }
    if (venue === "gemini") {
      const name = book === "spot" ? `${coin.toLowerCase()}usd` : `${coin.toLowerCase()}gusdperp`;
      return depth
        ? ws("wss://ws.gemini.com", JSON.stringify({ method: "SUBSCRIBE", params: [`${name}@depth10@100ms`], id: 1 }))
        : ws("wss://ws.gemini.com", JSON.stringify({ method: "SUBSCRIBE", params: [`${name}@bookTicker`], id: 1 }));
    }
    return missing;
  }

  if (call === "rest-ticker" || call === "rest-book") {
    const bookCall = call === "rest-book";
    if (venue === "binance" && book === "spot") return rest(bookCall ? `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=10` : `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
    if (venue === "binance" && book === "futures") return rest(bookCall ? `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10` : `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
    if (venue === "bybit") {
      const category = book === "spot" ? "spot" : "linear";
      return rest(bookCall ? `https://api.bybit.com/v5/market/orderbook?category=${category}&symbol=${symbol}&limit=10` : `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`);
    }
    if (venue === "okx") return rest(bookCall ? `https://www.okx.com/api/v5/market/books?instId=${inst}&sz=10` : `https://www.okx.com/api/v5/market/ticker?instId=${inst}`);
    if (venue === "coinbase" && book === "spot") return rest(bookCall ? `https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=${coin}-USD&limit=10` : `https://api.coinbase.com/api/v3/brokerage/market/products/${coin}-USD/ticker`);
    if (venue === "coinbase" && book === "futures") return rest(`https://api.coinbase.com/api/v3/brokerage/market/products/BIP-20DEC30-CDE/${bookCall ? "book?limit=10" : "ticker"}`);
    if (venue === "kraken" && book === "spot") return rest(bookCall ? `https://api.kraken.com/0/public/Depth?pair=${coin}USD&count=10` : `https://api.kraken.com/0/public/Ticker?pair=${coin}USD`);
    if (venue === "kraken" && book === "futures") return rest(`https://futures.kraken.com/derivatives/api/v3/tickers/${coin === "BTC" ? "PI_XBTUSD" : "PI_ETHUSD"}`);
    if (venue === "kucoin" && book === "spot") return rest(bookCall ? `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${coin}-USDT` : `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${coin}-USDT`);
    if (venue === "kucoin" && book === "futures") {
      const contract = coin === "BTC" ? "XBTUSDTM" : `${coin}USDTM`;
      return rest(bookCall ? `https://api-futures.kucoin.com/api/v1/level2/snapshot?symbol=${contract}` : `https://api-futures.kucoin.com/api/v1/ticker?symbol=${contract}`);
    }
    if (venue === "gate" && book === "spot") return rest(bookCall ? `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${pair(coin)}&limit=10` : `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair(coin)}`);
    if (venue === "gate" && book === "futures") return rest(bookCall ? `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${pair(coin)}&limit=10` : `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${pair(coin)}`);
    if (venue === "bitget" && book === "spot") return rest(bookCall ? `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${symbol}&limit=10` : `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`);
    if (venue === "bitget" && book === "futures") return rest(bookCall ? `https://api.bitget.com/api/v2/mix/market/orderbook?productType=USDT-FUTURES&symbol=${symbol}&limit=10` : `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${symbol}`);
    if (venue === "mexc" && book === "spot") return rest(bookCall ? `https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=10` : `https://api.mexc.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
    if (venue === "mexc" && book === "futures") return rest(bookCall ? `https://contract.mexc.com/api/v1/contract/depth/${pair(coin)}?limit=10` : `https://contract.mexc.com/api/v1/contract/ticker?symbol=${pair(coin)}`);
    if (venue === "htx" && book === "spot") return rest(bookCall ? `https://api.huobi.pro/market/depth?symbol=${lower}&type=step0&depth=10` : `https://api.huobi.pro/market/detail/merged?symbol=${lower}`);
    if (venue === "htx" && book === "futures") return rest(bookCall ? `https://api.hbdm.com/linear-swap-ex/market/depth?contract_code=${coin}-USDT&type=step0` : `https://api.hbdm.com/linear-swap-ex/market/detail/merged?contract_code=${coin}-USDT`);
    if (venue === "crypto-com") {
      const name = book === "spot" ? pair(coin) : `${coin}USD-PERP`;
      return rest(bookCall ? `https://api.crypto.com/exchange/v1/public/get-book?instrument_name=${name}&depth=10` : `https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${name}`);
    }
    if (venue === "upbit") return rest(bookCall ? `https://api.upbit.com/v1/orderbook?markets=KRW-${coin}` : `https://api.upbit.com/v1/ticker?markets=KRW-${coin}`);
    if (venue === "bitfinex") {
      const name = book === "spot" ? `t${coin}USD` : `t${coin === "BTC" ? "BTC" : "ETH"}F0:USTF0`;
      return rest(bookCall ? `https://api-pub.bitfinex.com/v2/book/${name}/P0?len=10` : `https://api-pub.bitfinex.com/v2/ticker/${name}`);
    }
    if (venue === "bitstamp") {
      const marketName = `${coin.toLowerCase()}usd${book === "futures" ? "-perp" : ""}`;
      return rest(bookCall ? `https://www.bitstamp.net/api/v2/order_book/${marketName}/` : `https://www.bitstamp.net/api/v2/ticker/${marketName}/`);
    }
    if (venue === "gemini") {
      const name = book === "spot" ? `${coin.toLowerCase()}usd` : `${coin.toLowerCase()}gusdperp`;
      return rest(bookCall ? `https://api.gemini.com/v1/book/${name}?limit_bids=10&limit_asks=10` : `https://api.gemini.com/v1/pubticker/${name}`);
    }
    return missing;
  }

  if (venue === "okx") return rest(`https://www.okx.com/api/v5/public/funding-rate?instId=${coin}-USDT-SWAP`);
  if (venue === "gate") return rest(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${pair(coin)}`);
  if (venue === "kucoin") return rest(`https://api-futures.kucoin.com/api/v1/funding-rate/${coin === "BTC" ? "XBTUSDTM" : `${coin}USDTM`}/current`);
  if (venue === "htx") return rest(`https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate?contract_code=${coin}-USDT`);
  if (venue === "gemini") return rest(`https://api.gemini.com/v1/fundingamount/${coin.toLowerCase()}gusdperp`);
  if (venue === "mexc") return rest(`https://contract.mexc.com/api/v1/contract/funding_rate/${pair(coin)}`);
  if (venue === "bitget") return rest(`https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES&symbol=${symbol}`);
  return missing;
}

function line(field, value, meaning) {
  return { field, value: String(value), meaning };
}

function ladder(bids, asks, symbol) {
  const bid = Array.isArray(bids?.[0]) ? bids[0][0] : bids?.[0]?.price ?? bids?.[0]?.p;
  const ask = Array.isArray(asks?.[0]) ? asks[0][0] : asks?.[0]?.price ?? asks?.[0]?.p;
  if (bid == null || ask == null) return null;
  return {
    rows: [line("symbol", symbol, "Selected coin"), line("bid", bid, "Best bid"), line("ask", ask, "Best ask")],
    bids,
    asks,
  };
}

export function explainMenu(venue, body, symbol) {
  if (!body || typeof body !== "object") return null;
  const data = body.data;
  const first = Array.isArray(data) ? data[0] : data;
  if (body.bidPrice != null && body.askPrice != null) return ladder([[body.bidPrice, body.bidQty]], [[body.askPrice, body.askQty]], body.symbol ?? symbol);
  if (body.bids && body.asks) return ladder(body.bids, body.asks, body.symbol ?? symbol);
  if (first?.bidPx != null) return ladder([[first.bidPx, first.bidSz]], [[first.askPx, first.askSz]], first.instId ?? symbol);
  if (first?.bids && first?.asks) return ladder(first.bids, first.asks, first.instId ?? first.s ?? symbol);
  if (first?.bid1Price != null) return ladder([[first.bid1Price, first.bid1Size]], [[first.ask1Price, first.ask1Size]], first.symbol ?? symbol);
  if (first?.bestBid != null) return ladder([[first.bestBid, first.bestBidSize]], [[first.bestAsk, first.bestAskSize]], symbol);
  if (first?.bestBidPrice != null) return ladder([[first.bestBidPrice, first.bestBidSize]], [[first.bestAskPrice, first.bestAskSize]], first.symbol ?? symbol);
  if (body.result && typeof body.result === "object" && !Array.isArray(body.result)) {
    const entry = Object.values(body.result)[0];
    if (entry?.b && entry?.a) return ladder([[entry.b[0], entry.b[2] ?? entry.b[1]]], [[entry.a[0], entry.a[2] ?? entry.a[1]]], symbol);
    if (Array.isArray(body.result?.bids)) return ladder(body.result.bids, body.result.asks, symbol);
  }
  if (body.tick?.bid) return ladder(body.tick.bids ?? [[body.tick.bid[0], body.tick.bid[1]]], body.tick.asks ?? [[body.tick.ask[0], body.tick.ask[1]]], symbol);
  if (Array.isArray(body) && body[0]?.market) {
    const unit = body[0].orderbook_units?.[0];
    if (unit) return ladder([[unit.bid_price, unit.bid_size]], [[unit.ask_price, unit.ask_size]], body[0].market);
    if (body[0].trade_price != null) return { rows: [line("symbol", body[0].market, "Market"), line("bid", body[0].trade_price, "Last trade")], bids: [[body[0].trade_price, "1"]], asks: [[body[0].trade_price, "1"]] };
  }
  if (Array.isArray(body) && typeof body[0] === "number") return ladder([[body[0], body[1]]], [[body[2], body[3]]], symbol);
  if (body.fundingAmount != null) return { rows: [line("symbol", body.symbol ?? symbol, "Symbol"), line("fundingAmount", body.fundingAmount, "Funding amount")], bids: [], asks: [] };
  if (first?.fundingRate != null || first?.funding_rate != null) return { rows: [line("symbol", first.instId ?? first.symbol ?? symbol, "Symbol"), line("funding", first.fundingRate ?? first.funding_rate, "Funding rate")], bids: [], asks: [] };
  if (body.funding_rate != null) return { rows: [line("symbol", body.name ?? body.symbol ?? symbol, "Symbol"), line("funding", body.funding_rate, "Funding rate")], bids: [], asks: [] };
  if (body.data?.funding_rate != null) return { rows: [line("symbol", body.data.contract_code ?? symbol, "Symbol"), line("funding", body.data.funding_rate, "Funding rate")], bids: [], asks: [] };
  return null;
}
