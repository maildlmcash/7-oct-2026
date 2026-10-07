import assert from "node:assert/strict";
import test from "node:test";
import { OKX_PUBLIC_WS, OKX_SPOT_CONNECTIONS, OKX_SWAP_CONNECTIONS, explainOkx } from "../services/okx-public.mjs";

test("OKX spot and swap connections stay on their own instruments", () => {
  assert.equal(OKX_PUBLIC_WS, "wss://ws.okx.com:8443/ws/v5/public");
  assert.ok(OKX_SPOT_CONNECTIONS.every((item) => item.instId === "BTC-USDT"));
  assert.ok(OKX_SWAP_CONNECTIONS.every((item) => item.instId === "BTC-USDT-SWAP"));
  assert.equal(OKX_SPOT_CONNECTIONS.some((item) => item.kind === "rest"), true);
  assert.equal(OKX_SWAP_CONNECTIONS.some((item) => item.channel === "funding-rate"), true);
  const rows = explainOkx("ws-tickers", "spot", {
    arg: { channel: "tickers", instId: "BTC-USDT" },
    data: [{ instId: "BTC-USDT", instType: "SPOT", last: "84074.1", bidPx: "84074.1", askPx: "84074.2", ts: "1" }],
  });
  assert.equal(rows?.find((row) => row.field === "last")?.value, "84074.1");
  assert.equal(explainOkx("ws-tickers", "spot", {
    arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
    data: [{ instId: "BTC-USDT-SWAP", last: "1", bidPx: "1", askPx: "1" }],
  }), null);
});
