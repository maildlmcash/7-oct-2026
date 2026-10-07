import assert from "node:assert/strict";
import test from "node:test";
import { COINBASE_FUTURE_CONNECTIONS, COINBASE_PUBLIC_WS, COINBASE_SPOT_CONNECTIONS, explainCoinbase } from "../services/coinbase-public.mjs";

test("Coinbase spot and futures stay on their own products", () => {
  assert.equal(COINBASE_PUBLIC_WS, "wss://advanced-trade-ws.coinbase.com");
  assert.ok(COINBASE_SPOT_CONNECTIONS.every((item) => item.productId === "BTC-USD"));
  assert.equal(COINBASE_SPOT_CONNECTIONS.some((item) => item.channel === "level2"), true);
  assert.equal(COINBASE_SPOT_CONNECTIONS.some((item) => item.channel === "user"), false);
  assert.equal(COINBASE_FUTURE_CONNECTIONS.some((item) => item.channel === "candles" && item.kind === "rest"), true);
  const rows = explainCoinbase("ws-ticker", "spot", {
    channel: "ticker",
    events: [{ tickers: [{ product_id: "BTC-USD", price: "84045.69", best_bid: "84045.69", best_ask: "84045.7", best_bid_quantity: "0.05", best_ask_quantity: "0.1" }] }],
  });
  assert.equal(rows?.find((row) => row.field === "price")?.value, "84045.69");
  assert.equal(explainCoinbase("ws-ticker", "spot", {
    channel: "ticker",
    events: [{ tickers: [{ product_id: "BIP-20DEC30-CDE", price: "1", best_bid: "1", best_ask: "1" }] }],
  }), null);
});
