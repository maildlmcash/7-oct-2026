import assert from "node:assert/strict";
import test from "node:test";
import { explainBitget } from "../services/bitget-public.mjs";
import { explainGate } from "../services/gate-public.mjs";

test("Gate and Bitget spot frames are not accepted as futures", () => {
  const gate = explainGate("ws-book", "spot", {
    channel: "spot.book_ticker",
    event: "update",
    result: { s: "BTC_USDT", b: "1", B: "2", a: "3", A: "4" },
  });
  assert.equal(gate?.find((row) => row.field === "b")?.value, "1");
  assert.equal(explainGate("ws-book", "futures", {
    channel: "spot.book_ticker",
    event: "update",
    result: { s: "BTC_USDT", b: "1", a: "3" },
  }), null);
  const bitget = explainBitget("ws-ticker", "futures", {
    arg: { instType: "USDT-FUTURES", channel: "ticker", instId: "BTCUSDT" },
    data: [{ instId: "BTCUSDT", bidPr: "1", askPr: "2", lastPr: "1.5", markPrice: "1.4", fundingRate: "0.0001" }],
  });
  assert.equal(bitget?.find((row) => row.field === "markPrice")?.value, "1.4");
  assert.equal(explainBitget("ws-ticker", "futures", {
    arg: { instType: "SPOT", channel: "ticker", instId: "BTCUSDT" },
    data: [{ instId: "BTCUSDT", bidPr: "1", askPr: "2", lastPr: "1.5" }],
  }), null);
});
