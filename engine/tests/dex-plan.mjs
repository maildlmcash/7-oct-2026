import assert from "node:assert/strict";
import test from "node:test";
import { DEX_VENUES, dexScore } from "../services/dex-plan.mjs";

test("ethereum DEX list and prediction score stay explicit", () => {
  assert.deepEqual(DEX_VENUES.filter((venue) => venue.chain === "ethereum").map((venue) => venue.name), ["Uniswap V2", "Uniswap V3", "SushiSwap V2", "Curve Finance", "Balancer V2"]);
  assert.deepEqual(DEX_VENUES.filter((venue) => venue.chain === "arbitrum").map((venue) => venue.name), ["Uniswap V3", "SushiSwap V2", "DODO V2"]);
  assert.deepEqual(DEX_VENUES.filter((venue) => venue.chain === "order-book").map((venue) => venue.name), ["dYdX V3"]);
  assert.deepEqual(DEX_VENUES.filter((venue) => venue.chain === "hybrid").map((venue) => venue.name), ["Hyperliquid"]);
  assert.deepEqual(DEX_VENUES.filter((venue) => venue.chain === "index").map((venue) => venue.name), ["DexScreener"]);
  assert.deepEqual(dexScore(1_000, 0), { liquidityPoints: 0, activityPoints: 0, score: 0, weight: 0, use: "Ignored in Predictions. Liquidity is under $10,000." });
  const rich = dexScore(100_000_000, 100_000_000);
  assert.equal(rich.liquidityPoints, 70);
  assert.equal(rich.activityPoints, 30);
  assert.equal(rich.score, 100);
  const quiet = dexScore(10_000, 0);
  assert.equal(quiet.score, 0);
  assert.match(quiet.use, /under 40/);
});
