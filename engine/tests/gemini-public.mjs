import assert from "node:assert/strict";
import test from "node:test";
import { explainGemini } from "../services/gemini-public.mjs";

test("Gemini spot and perpetual frames stay apart", () => {
  const spot = explainGemini("ws-book", "spot", {
    type: "update",
    events: [{ side: "bid", price: "1.1", remaining: "2" }, { side: "ask", price: "1.2", remaining: "3" }],
  });
  assert.equal(spot?.find((row) => row.field === "symbol")?.value, "btcusd");
  assert.equal(explainGemini("rest-funding", "spot", { symbol: "btcgusdperp", fundingAmount: 1 }), null);
  const perp = explainGemini("rest-funding", "futures", { symbol: "btcgusdperp", fundingAmount: 1.5, nextFundingTimestamp: 9 });
  assert.equal(perp?.find((row) => row.field === "fundingAmount")?.value, "1.5");
  const depth = explainGemini("ws-depth", "spot", { symbol: "btcusd", lastUpdateId: 7, bids: [["1", "2"]], asks: [["3", "4"]] });
  assert.equal(depth?.find((row) => row.field === "bid 1")?.value, "1 × 2");
  assert.equal(explainGemini("ws-depth", "futures", { symbol: "btcusd", lastUpdateId: 7, bids: [["1", "2"]], asks: [["3", "4"]] }), null);
  const ticker = explainGemini("ws-ticker", "futures", { s: "btcgusdperp", b: "3", a: "4", c: "3.5" });
  assert.equal(ticker?.find((row) => row.field === "s")?.value, "btcgusdperp");
  assert.equal(explainGemini("ws-ticker", "spot", { s: "btcgusdperp", b: "3", a: "4" }), null);
});
