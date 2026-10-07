import assert from "node:assert/strict";
import test from "node:test";
import { explainHtx } from "../services/htx-public.mjs";
import { explainMexc } from "../services/mexc-public.mjs";

test("MEXC and HTX reject the other book's symbol", () => {
  const mexc = explainMexc("rest-book", "spot", { symbol: "BTCUSDT", bidPrice: "1", askPrice: "2" });
  assert.equal(mexc?.[0]?.value, "BTCUSDT");
  assert.equal(explainMexc("ws-ticker", "futures", { symbol: "BTCUSDT", data: { lastPrice: 1, bid1: 1 } }), null);
  const htx = explainHtx("ws-bbo", "futures", { ch: "market.BTC-USDT.bbo", tick: { bid: [1, 2], ask: [3, 4] } });
  assert.equal(htx?.find((row) => row.field === "bid")?.value, "1");
  assert.equal(explainHtx("ws-bbo", "spot", { ch: "market.BTC-USDT.bbo", tick: { bid: 1, ask: 2, symbol: "btcusdt" } }), null);
});
