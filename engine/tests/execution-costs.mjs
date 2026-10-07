import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as costs from "../services/execution-costs.mjs";
import { EXECUTION_NET_RETURN, readExecutionCost } from "../services/execution-costs.mjs";

// The book is the decision 0034 depth example: bids 0.0025 then 0.0024,
// asks 0.0026 then 0.0027, quantities 3 and 1, spread 0.0001.
// Fee rate 0.001 is a caller fixture. The source names no fee tier.
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

function book(extra) {
  return {
    bids: BIDS.map((row) => [...row]),
    asks: ASKS.map((row) => [...row]),
    quantity: "4",
    feeRate: "0.001",
    ...extra,
  };
}

test("the known depth book reconciles the round-trip cost", () => {
  const full = readExecutionCost(book());
  const again = readExecutionCost(structuredClone(book({ lastPrice: "0.001" })));
  assert.equal(full.ok, true, full.error);
  assert.equal(full.costsApplied, true);
  assert.equal(full.action, null);
  assert.equal(full.confidence, null);
  assert.equal(full.spread, "0.0001");
  assert.equal(full.averageBuy, "0.002625");
  assert.equal(full.averageSell, "0.002475");
  assert.equal(full.feeReturn, "0.002");
  assert.equal(full.spreadReturn, "2/51");
  assert.equal(full.slippageReturn, "1/51");
  assert.equal(full.impactReturn, "1/17");
  assert.equal(full.netReturn, "-517/8500");
  assert.deepEqual(again, full);
  assert.equal(JSON.stringify(full).includes("0.001"), false);

  const touch = readExecutionCost(book({ quantity: "3" }));
  assert.equal(touch.ok, true, touch.error);
  assert.equal(touch.averageBuy, "0.0026");
  assert.equal(touch.averageSell, "0.0025");
  assert.equal(touch.slippageReturn, "0");
  assert.equal(touch.spreadReturn, "2/51");
  assert.equal(touch.impactReturn, "2/51");
  assert.equal(touch.feeReturn, "0.002");
  assert.equal(touch.netReturn, "-1051/25500");

  const noFee = readExecutionCost(book({ feeRate: "0", quantity: "3" }));
  assert.equal(noFee.ok, true, noFee.error);
  assert.equal(noFee.feeReturn, "0");
  assert.equal(noFee.impactReturn, "2/51");
  assert.equal(noFee.netReturn, "-2/51");
});

test("uncertain cost is no-trade with low confidence and lastPrice is not a fill", () => {
  const short = readExecutionCost(book({ quantity: "5" }));
  assert.equal(short.ok, false);
  assert.equal(short.blocked, "BLOCKED");
  assert.equal(short.action, "no-trade");
  assert.equal(short.confidence, "low");
  assert.equal(short.error, "depth is not sufficient");
  assert.equal(short.netReturn, null);
  assert.equal(short.averageBuy, null);
  assert.equal(short.costsApplied, false);
  assert.equal(JSON.stringify(short).includes("0.002625"), false);

  const lastOnly = readExecutionCost({ lastPrice: "0.001", quantity: "1", feeRate: "0.001" });
  assert.equal(lastOnly.action, "no-trade");
  assert.equal(lastOnly.confidence, "low");
  assert.equal(lastOnly.error, "last price is not a fill");
  assert.equal(lastOnly.netReturn, null);
  assert.equal(JSON.stringify(lastOnly).includes("0.001"), false);

  const missingFee = readExecutionCost(book({ feeRate: undefined }));
  assert.equal(missingFee.error, "fee is not configured");
  assert.equal(missingFee.action, "no-trade");
  assert.equal(missingFee.confidence, "low");
  assert.equal(missingFee.netReturn, null);

  const crossed = readExecutionCost(book({
    bids: [["0.0026", "3"]],
    asks: [["0.0025", "3"]],
  }));
  assert.equal(crossed.error, "book is not valid");
  assert.equal(crossed.action, "no-trade");
  assert.equal(crossed.confidence, "low");

  const missingBook = readExecutionCost({ quantity: "1", feeRate: "0.001" });
  assert.equal(missingBook.error, "book is not valid");
  assert.equal(missingBook.confidence, "low");

  const guessed = readExecutionCost(book({ feeRate: "guessed" }));
  assert.equal(guessed.error, "unsupported field");
  assert.equal(guessed.confidence, null);
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);
});

test("the cost export stays closed and paper mode stays locked", () => {
  assert.equal(EXECUTION_NET_RETURN, "round-trip fee plus spread and depth slippage");
  assert.deepEqual(Object.keys(costs).sort(), [
    "EXECUTION_NET_RETURN",
    "readExecutionCost",
  ]);
  assert.equal("placeOrder" in costs, false);
  const source = readFileSync(new URL("../services/execution-costs.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("S_spot"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
