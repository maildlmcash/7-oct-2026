import assert from "node:assert/strict";
import test from "node:test";
import { BYBIT_LINEAR, BYBIT_SPOT, parseBybitBook } from "../services/bybit-public.mjs";

test("Bybit public books stay on their own hosts and ignore other frames", () => {
  assert.equal(BYBIT_SPOT.origin, "wss://stream.bybit.com/v5/public/spot");
  assert.equal(BYBIT_LINEAR.origin, "wss://stream.bybit.com/v5/public/linear");
  assert.notEqual(BYBIT_SPOT.origin, BYBIT_LINEAR.origin);
  const book = parseBybitBook({
    topic: "orderbook.1.BTCUSDT",
    type: "snapshot",
    data: { s: "BTCUSDT", b: [["84168.6", "1.979259"]], a: [["84168.7", "0.282268"]], u: 115606868 },
  });
  assert.equal(book?.bid, "84168.6");
  assert.equal(parseBybitBook({ topic: "orderbook.1.BTCUSDT", type: "delta", data: { s: "BTCUSDT", b: [["1", "1"]], a: [["2", "1"]], u: 1 } }), null);
  assert.equal(parseBybitBook({ op: "pong" }), null);
});
