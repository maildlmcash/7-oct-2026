import assert from "node:assert/strict";
import test from "node:test";
import { explainCryptoCom } from "../services/crypto-com-public.mjs";
import { explainUpbit } from "../services/upbit-public.mjs";

test("Crypto.com and Upbit reject the other instrument", () => {
  const spot = explainCryptoCom("ws-ticker", "spot", {
    code: 0,
    result: { instrument_name: "BTC_USDT", channel: "ticker", data: [{ i: "BTC_USDT", b: "1", k: "2", a: "1.5" }] },
  });
  assert.equal(spot?.find((row) => row.field === "i")?.value, "BTC_USDT");
  assert.equal(explainCryptoCom("ws-ticker", "futures", {
    code: 0,
    result: { instrument_name: "BTC_USDT", channel: "ticker", data: [{ i: "BTC_USDT", b: "1", k: "2", a: "1.5" }] },
  }), null);
  const upbit = explainUpbit("ws-ticker", { type: "ticker", code: "KRW-BTC", trade_price: 100 });
  assert.equal(upbit?.find((row) => row.field === "code")?.value, "KRW-BTC");
  assert.equal(explainUpbit("ws-ticker", { type: "ticker", code: "USDT-BTC", trade_price: 1 }), null);
});
