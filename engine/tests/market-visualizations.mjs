import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { readMarketFeatures } from "../services/market-features.mjs";
import { readCurrentWhaleEligibility } from "../services/whale-eligibility.mjs";
import * as charts from "../services/market-visualizations.mjs";
import {
  MARKET_VISUALIZATION_VIEWS,
  marketVisualizationLayout,
  readMarketVisualization,
} from "../services/market-visualizations.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Spread 0.0001, CVD 1.5, funding 0.0001, open interest 12, and liquidation 5
// are the same caller-supplied feature fixtures. This view does not recompute them.
// Raw amount 10000000 is the Raydium CLI integer for 0.01 SOL. The chart keeps the integer.
// Widths 375, 768, and 1280 are layout fixtures. The source names no pixel breakpoint.
const TIME = 1499865549590;
const BOUND = 2;

function read(view, extra) {
  const result = readMarketVisualization({ view, bound: BOUND, ...extra });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.direction, null);
  assert.equal(result.guaranteesDirection, false);
  assert.equal(result.layout.columns, 1);
  assert.equal(result.layout.stack, "column");
  return result;
}

test("chart units, bounds, and time ranges do not promise a direction", () => {
  assert.deepEqual(MARKET_VISUALIZATION_VIEWS, [
    "price/volume",
    "spread",
    "depth heatmap",
    "CVD",
    "VWAP",
    "funding/OI/basis",
    "liquidation",
    "DEX liquidity",
    "whale-flow",
  ]);

  const price = read("price/volume", {
    from: TIME,
    to: TIME + 3,
    points: [
      { eventTime: TIME - 10, price: "0.0024", volume: "1" },
      { eventTime: TIME + 2, price: "0.0027", volume: "3" },
      { eventTime: TIME, price: "0.0025", volume: "4" },
      { eventTime: TIME + 1, price: "0.0026", volume: "2" },
      { eventTime: TIME + 3, price: "0.0028", volume: "5" },
    ],
  });
  assert.equal(price.unit, "price and volume");
  assert.equal(price.truncated, true);
  assert.equal(price.empty, false);
  assert.deepEqual(price.points, [
    { eventTime: TIME, price: "0.0025", volume: "4" },
    { eventTime: TIME + 1, price: "0.0026", volume: "2" },
  ]);
  assert.equal(JSON.stringify(price).includes("0.0024"), false);
  assert.equal(JSON.stringify(price).includes("0.0027"), false);

  const feature = readMarketFeatures({
    eventTime: TIME,
    sequence: 28457,
    sequenceWatermark: null,
    quality: { healthy: true, reason: null },
    bidPrice: "0.0025",
    askPrice: "0.0026",
    trades: [
      { side: "buy", quantity: "2.5", price: "0.0026" },
      { side: "sell", quantity: "1", price: "0.0025" },
    ],
    funding: "0.0001",
    openInterest: "12",
    liquidation: "5",
  });
  const featureRow = Object.fromEntries(feature.features.map((row) => [row.name, row]));

  const spread = read("spread", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, value: featureRow.spread.value }],
  });
  assert.equal(spread.unit, "price difference");
  assert.equal(spread.points[0].value, "0.0001");
  assert.equal(spread.palette, null);

  const depth = read("depth heatmap", {
    from: TIME,
    to: TIME,
    points: [
      { eventTime: TIME, price: "0.0025", quantity: "4" },
      { eventTime: TIME, price: "0.0024", quantity: "3" },
      { eventTime: TIME, price: "0.0023", quantity: "1" },
    ],
  });
  assert.equal(depth.unit, "price and quantity");
  assert.equal(depth.palette, null);
  assert.equal(depth.truncated, true);
  assert.equal(depth.points.length, BOUND);
  assert.equal(depth.points[0].quantity, "4");
  assert.equal(depth.points[1].quantity, "3");
  assert.equal(JSON.stringify(depth).includes("color"), false);

  const cvd = read("CVD", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, value: featureRow.CVD.value }],
  });
  assert.equal(cvd.unit, "taker buy minus taker sell");
  assert.equal(cvd.points[0].value, "1.5");

  const funding = read("funding/OI/basis", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, funding: "0.0001", openInterest: "12" }],
  });
  assert.equal(funding.unit, "source value");
  assert.equal(funding.points[0].funding, "0.0001");
  assert.equal(funding.points[0].openInterest, "12");
  assert.equal(funding.points[0].basis, null);

  const liquidation = read("liquidation", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, value: featureRow.liquidation.value }],
  });
  assert.equal(liquidation.unit, "source value");
  assert.equal(liquidation.points[0].value, "5");

  const dex = read("DEX liquidity", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, amount: "10000000" }],
  });
  assert.equal(dex.unit, "raw amount");
  assert.equal(dex.points[0].amount, "10000000");
  assert.equal(JSON.stringify(dex).includes("0.01"), false);

  for (const view of MARKET_VISUALIZATION_VIEWS) {
    if (view === "VWAP" || view === "whale-flow") continue;
    const row = read(view, { from: TIME, to: TIME, points: [] });
    assert.equal(row.direction, null);
    assert.equal(row.view, view);
  }

  assert.equal(readMarketVisualization({ view: "spread", from: TIME, to: TIME }).error, "bound is required");
  assert.equal(readMarketVisualization({ view: "spread", bound: 0, from: TIME, to: TIME }).error, "bound is required");
  assert.equal(readMarketVisualization({ bound: BOUND, from: TIME, to: TIME }).error, "view is required");
  const named = readMarketVisualization({ view: "up", bound: BOUND, from: TIME, to: TIME });
  assert.equal(named.error, "unsupported field");
  assert.equal(Object.hasOwn(named, "view"), false);
  const inverted = readMarketVisualization({
    view: "spread",
    bound: BOUND,
    from: TIME + 1,
    to: TIME,
    points: [{ eventTime: TIME, value: "0.0001" }],
  });
  assert.equal(inverted.ok, false);
  assert.equal(inverted.error, "unsupported field");
  assert.equal(inverted.direction, null);
  assert.equal(JSON.stringify(inverted).includes("0.0001"), false);
});

test("empty and stale chart data stay empty", () => {
  const empty = read("price/volume", { from: TIME, to: TIME, points: [] });
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.points, []);
  assert.equal(JSON.stringify(empty.points), "[]");

  const outside = read("price/volume", {
    from: TIME + 5,
    to: TIME + 6,
    points: [{ eventTime: TIME, price: "0.0025", volume: "4" }],
  });
  assert.equal(outside.empty, true);
  assert.deepEqual(outside.points, []);
  assert.equal(JSON.stringify(outside).includes("0.0025"), false);

  const missingVolume = readMarketVisualization({
    view: "price/volume",
    bound: BOUND,
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, price: "0.0025" }],
  });
  assert.equal(missingVolume.ok, false);
  assert.equal(missingVolume.error, "unsupported field");
  assert.equal(JSON.stringify(missingVolume).includes("0.0025"), false);
  assert.equal(JSON.stringify(missingVolume).includes("\"0\""), false);

  const explicitZero = read("price/volume", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, price: "0.0025", volume: "0" }],
  });
  assert.equal(explicitZero.points[0].volume, "0");

  const explicitFunding = read("funding/OI/basis", {
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, funding: "0" }],
  });
  assert.equal(explicitFunding.points[0].funding, "0");
  assert.equal(explicitFunding.points[0].openInterest, null);
  assert.equal(explicitFunding.points[0].basis, null);

  const unset = read("spread", {
    points: [{ eventTime: TIME, value: "0.0001" }],
  });
  assert.equal(unset.rangeSet, false);
  assert.equal(unset.note, "time range is not set");
  assert.deepEqual(unset.points, []);
  assert.equal(JSON.stringify(unset).includes("0.0001"), false);

  const stale = read("price/volume", {
    from: TIME,
    to: TIME,
    stale: true,
    points: [{ eventTime: TIME, price: "0.0025", volume: "4" }],
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.empty, true);
  assert.deepEqual(stale.points, []);
  assert.equal(stale.quality.reason, "stale stream");
  assert.equal(JSON.stringify(stale).includes("0.0025"), false);

  const degraded = read("CVD", {
    from: TIME,
    to: TIME,
    quality: "degraded",
    points: [{ eventTime: TIME, value: "1.5" }],
  });
  assert.equal(degraded.stale, true);
  assert.deepEqual(degraded.points, []);
  assert.equal(degraded.quality.reason, "degraded");
  assert.equal(JSON.stringify(degraded).includes("1.5"), false);

  const unhealthy = read("liquidation", {
    from: TIME,
    to: TIME,
    quality: { healthy: false, reason: "stale stream" },
    points: [{ eventTime: TIME, value: "5" }],
  });
  assert.equal(unhealthy.stale, true);
  assert.deepEqual(unhealthy.points, []);
  assert.equal(JSON.stringify(unhealthy).includes("\"5\""), false);

  const decimalAmount = readMarketVisualization({
    view: "DEX liquidity",
    bound: BOUND,
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, amount: "0.01" }],
  });
  assert.equal(decimalAmount.ok, false);
  assert.equal(decimalAmount.error, "unsupported field");
  assert.equal(JSON.stringify(decimalAmount).includes("0.01"), false);
});

test("VWAP stays unplotted, whale-flow stays blocked, and every width uses one column", () => {
  const vwap = read("VWAP", { from: TIME, to: TIME });
  assert.equal(vwap.unit, null);
  assert.equal(vwap.formula, "NOT IN SOURCE");
  assert.deepEqual(vwap.points, []);
  assert.equal(vwap.empty, true);

  const guessed = readMarketVisualization({
    view: "VWAP",
    bound: BOUND,
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, price: "0.0026", volume: "4" }],
  });
  assert.equal(guessed.ok, false);
  assert.equal(guessed.error, "unsupported field");
  assert.equal(guessed.direction, null);
  assert.equal(JSON.stringify(guessed).includes("0.0026"), false);

  const unsetVwap = read("VWAP", {});
  assert.equal(unsetVwap.formula, "NOT IN SOURCE");
  assert.equal(unsetVwap.note, "time range is not set");
  assert.deepEqual(unsetVwap.points, []);

  const eligibility = readCurrentWhaleEligibility();
  const whales = readMarketVisualization({ view: "whale-flow", bound: BOUND });
  assert.equal(whales.ok, false);
  assert.equal(whales.blocked, "BLOCKED");
  assert.equal(whales.error, eligibility.error);
  assert.equal(whales.error, "evidence is insufficient");
  assert.deepEqual(whales.entries, []);
  assert.deepEqual(whales.points, []);
  assert.equal(whales.direction, null);
  assert.equal(whales.guaranteesDirection, false);
  assert.equal(whales.unit, null);

  const planted = readMarketVisualization({
    view: "whale-flow",
    bound: BOUND,
    from: TIME,
    to: TIME,
    points: [{ eventTime: TIME, entity: "wallet" }],
  });
  assert.equal(planted.ok, false);
  assert.equal(planted.error, "unsupported field");
  assert.equal(JSON.stringify(planted).includes("wallet"), false);

  const narrow = marketVisualizationLayout({ width: 375 });
  const tablet = marketVisualizationLayout({ width: 768 });
  const wide = marketVisualizationLayout({ width: 1280 });
  const omitted = marketVisualizationLayout();
  for (const layout of [narrow, tablet, wide, omitted]) {
    assert.equal(layout.ok, true);
    assert.equal(layout.columns, 1);
    assert.equal(layout.stack, "column");
    assert.equal(layout.maxWidth, "100%");
    assert.equal(layout.wrap, true);
    assert.equal(layout.direction, null);
    assert.equal(layout.guaranteesDirection, false);
  }
  assert.equal(narrow.width, 375);
  assert.equal(omitted.width, null);
  assert.equal(marketVisualizationLayout({ width: 0 }).error, "unsupported field");
  const directed = marketVisualizationLayout({ direction: "up" });
  assert.equal(directed.error, "unsupported field");
  assert.equal(Object.hasOwn(directed, "width"), false);

  assert.deepEqual(Object.keys(charts).sort(), [
    "MARKET_VISUALIZATION_LAYOUT",
    "MARKET_VISUALIZATION_VIEWS",
    "marketVisualizationLayout",
    "readMarketVisualization",
  ]);
  assert.equal("placeOrder" in charts, false);
  assert.equal("fill" in charts, false);
  assert.equal("submit" in charts, false);
  const source = readFileSync(new URL("../services/market-visualizations.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
