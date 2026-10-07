import assert from "node:assert/strict";
import test from "node:test";
import { explainBitfinex } from "../services/bitfinex-public.mjs";
import { explainBitstamp } from "../services/bitstamp-public.mjs";

test("Bitfinex and Bitstamp keep spot and perpetual apart", () => {
  const spot = explainBitfinex("rest-ticker", "spot", [10, 1, 11, 1, 0, 0, 10.5]);
  assert.equal(spot?.find((row) => row.field === "symbol")?.value, "tBTCUSD");
  assert.equal(explainBitstamp("rest-ticker", "spot", { bid: "1", ask: "2", last: "1.5", mark_price: "1.4" }), null);
  const perp = explainBitstamp("ws-book", "futures", {
    event: "data",
    channel: "order_book_btcusd-perp",
    data: { bids: [["3", "1"]], asks: [["4", "1"]] },
  });
  assert.equal(perp?.find((row) => row.field === "bid")?.value, "3");
  assert.equal(explainBitstamp("ws-book", "spot", {
    event: "data",
    channel: "order_book_btcusd-perp",
    data: { bids: [["3", "1"]], asks: [["4", "1"]] },
  }), null);
});
