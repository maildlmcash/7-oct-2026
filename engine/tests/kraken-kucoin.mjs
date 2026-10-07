import assert from "node:assert/strict";
import test from "node:test";
import { explainKraken } from "../services/kraken-public.mjs";
import { explainKucoin } from "../services/kucoin-public.mjs";

test("Kraken and KuCoin parsers reject the other book", () => {
  const kraken = explainKraken("ws-ticker", "spot", {
    channel: "ticker",
    data: [{ symbol: "BTC/USD", bid: 1, ask: 2, last: 1.5 }],
  });
  assert.equal(kraken?.find((row) => row.field === "bid")?.value, "1");
  assert.equal(explainKraken("ws-ticker", "futures", {
    channel: "ticker",
    data: [{ symbol: "BTC/USD", bid: 1, ask: 2, last: 1 }],
  }), null);
  const future = explainKraken("ws-ticker", "futures", { feed: "ticker", product_id: "PI_XBTUSD", bid: 1, ask: 2, last: 1 });
  assert.equal(future?.find((row) => row.field === "product_id")?.value, "PI_XBTUSD");
  const kucoin = explainKucoin("ws-ticker", "futures", {
    type: "message",
    topic: "/contractMarket/tickerV2:XBTUSDTM",
    data: { symbol: "XBTUSDTM", bestBidPrice: "10", bestAskPrice: "11" },
  });
  assert.equal(kucoin?.find((row) => row.field === "symbol")?.value, "XBTUSDTM");
  assert.equal(explainKucoin("ws-ticker", "spot", {
    type: "message",
    topic: "/contractMarket/tickerV2:XBTUSDTM",
    data: { symbol: "XBTUSDTM", bestBidPrice: "10", bestAskPrice: "11" },
  }), null);
});
