import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { simulateBacktestFill } from "../services/backtest-fills.mjs";
import * as fills from "../services/backtest-fills.mjs";
import { readExecutionCost } from "../services/execution-costs.mjs";

const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

const NUMBER = "(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const FRACTION = new RegExp(`^(-?)(${NUMBER})(?:/(${NUMBER}))?$`);

function book(extra) {
  return {
    bids: BIDS.map((row) => [...row]),
    asks: ASKS.map((row) => [...row]),
    quantity: "4",
    feeRate: "0.001",
    ...extra,
  };
}

function parseSigned(value) {
  const match = FRACTION.exec(value);
  assert.equal(match !== null, true, value);
  const sign = match[1] === "-" ? -1n : 1n;
  const [whole, frac = ""] = match[2].split(".");
  const numerator = BigInt(`${whole}${frac}`.replace(/^0+(?=\d)/, ""));
  const denominator = match[3] === undefined ? 10n ** BigInt(frac.length) : BigInt(match[3]);
  return { n: sign * numerator, d: denominator };
}

function add(left, right) {
  return { n: left.n * right.d + right.n * left.d, d: left.d * right.d };
}

function reconciles(fill) {
  const cost = add(add(parseSigned(fill.feeReturn), parseSigned(fill.spreadReturn)), parseSigned(fill.slippageReturn));
  const net = parseSigned(fill.netReturn);
  assert.equal(cost.n * net.d, -net.n * cost.d);
}

test("each covered order reconciles its own fee, spread, and slippage", () => {
  const fullCost = readExecutionCost(book());
  const touchCost = readExecutionCost(book({ quantity: "3" }));
  const full = simulateBacktestFill(book());
  const touch = simulateBacktestFill(book({ quantity: "3" }));
  assert.equal(full.ok, true, full.error);
  assert.equal(touch.ok, true, touch.error);
  assert.equal(full.netReturn, fullCost.netReturn);
  assert.equal(touch.netReturn, touchCost.netReturn);
  assert.equal(full.netReturn, "-517/8500");
  assert.equal(touch.netReturn, "-1051/25500");
  assert.equal(full.feeReturn, fullCost.feeReturn);
  assert.equal(full.spreadReturn, fullCost.spreadReturn);
  assert.equal(full.slippageReturn, fullCost.slippageReturn);
  assert.equal(touch.feeReturn, touchCost.feeReturn);
  assert.equal(touch.spreadReturn, touchCost.spreadReturn);
  assert.equal(touch.slippageReturn, touchCost.slippageReturn);
  reconciles(full);
  reconciles(touch);
  assert.notEqual(full.netReturn, touch.netReturn);
  assert.equal(full.spread, "0.0001");
  assert.equal(full.partial, false);
  assert.equal(full.unfilledQuantity, "0");
  assert.equal(full.funding, null);
  assert.equal(full.orderSubmitted, false);
  assert.equal(touch.orderSubmitted, false);
  assert.equal(full.assumptions.includes("funding is NOT IN SOURCE"), true);
  assert.equal(full.assumptions.includes("partial fill is not configured"), true);
  assert.equal(full.assumptions.includes("cancellation is not configured"), true);
  const again = simulateBacktestFill(book());
  assert.deepEqual(again, full);
});

test("partial size, short depth, funding, and cancellation stay explicit", () => {
  const partial = simulateBacktestFill(book({ quantity: "4", filledQuantity: "3", funding: "0.01" }));
  assert.equal(partial.ok, true, partial.error);
  assert.equal(partial.partial, true);
  assert.equal(partial.filledQuantity, "3");
  assert.equal(partial.unfilledQuantity, "1");
  assert.equal(partial.funding, "0.01");
  assert.equal(partial.netReturn, "-1051/25500");
  assert.equal(partial.orderSubmitted, false);
  assert.equal(partial.assumptions.includes("partial fill uses the caller-supplied filled quantity"), true);
  assert.equal(partial.assumptions.includes("funding is NOT IN SOURCE"), false);

  const short = simulateBacktestFill(book({ quantity: "5", filledQuantity: "5" }));
  assert.equal(short.blocked, "BLOCKED");
  assert.equal(short.error, "depth is not sufficient");
  assert.equal(short.action, "no-trade");
  assert.equal(short.netReturn, null);
  assert.equal(short.filledQuantity, null);
  assert.equal(short.costsApplied, false);
  assert.equal(short.orderSubmitted, false);
  assert.equal(short.assumptions.includes("partial fill is not supported when depth cannot cover the quantity"), true);
  const emptyBook = simulateBacktestFill(book({ bids: [], asks: [] }));
  assert.equal(emptyBook.blocked, "BLOCKED");
  assert.equal(emptyBook.costsApplied, false);
  assert.equal(emptyBook.netReturn, null);
  assert.equal(emptyBook.filledQuantity, null);
  assert.equal(emptyBook.orderSubmitted, false);

  const lastOnly = simulateBacktestFill({ lastPrice: "0.001", quantity: "1", feeRate: "0.001" });
  assert.equal(lastOnly.error, "last price is not a fill");
  assert.equal(JSON.stringify(lastOnly).includes("0.001"), false);

  const cancelled = simulateBacktestFill(book({ cancelled: true, funding: "0" }));
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.action, "cancelled");
  assert.equal(cancelled.costsApplied, false);
  assert.equal(cancelled.funding, "0");
  assert.equal(cancelled.orderSubmitted, false);
  assert.equal(cancelled.assumptions[0], "cancellation is caller-supplied");
});

test("the backtest fill export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(fills).sort(), ["simulateBacktestFill"]);
  const source = readFileSync(new URL("../services/backtest-fills.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readExecutionCost"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  const costs = readFileSync(new URL("../services/execution-costs.mjs", import.meta.url), "utf8");
  assert.equal(costs.includes("simulateBacktestFill"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
