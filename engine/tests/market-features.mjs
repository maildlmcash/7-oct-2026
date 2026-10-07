import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as features from "../services/market-features.mjs";
import { readMarketFeatures } from "../services/market-features.mjs";

// Book decimals 0.0025 and 0.0026 are the existing depth fixture.
// Depth totals 4 and 4, then 3 and 4, match that fixture's imbalance.
// Trade quantities and the futures fields are formula fixtures, not stored market facts.
const TIME = 1499865549590;
const HEALTHY = { healthy: true, reason: null };

function byName(result) {
  return Object.fromEntries(result.features.map((feature) => [feature.name, feature]));
}

function read(extra) {
  const result = readMarketFeatures({
    eventTime: TIME,
    sequence: 28457,
    sequenceWatermark: null,
    quality: HEALTHY,
    ...extra,
  });
  assert.equal(result.ok, true, result.error);
  return result;
}

test("reference fixtures match the source formulas and timestamps", () => {
  const balanced = read({
    bidPrice: "0.0025",
    askPrice: "0.0026",
    bidDepth: "4",
    askDepth: "4",
    trades: [
      { side: "buy", quantity: "2.5", price: "0.0026" },
      { side: "sell", quantity: "1", price: "0.0025" },
    ],
    funding: "0.0001",
    openInterest: "12",
    liquidation: "5",
  });
  const row = byName(balanced);
  assert.equal(balanced.stale, false);
  assert.equal(balanced.inputWatermark, TIME);
  assert.equal(balanced.sequenceWatermark, 28457);
  assert.equal(row.spread.value, "0.0001");
  assert.equal(row.spread.formula, "best ask minus best bid");
  assert.equal(row.spread.eventTime, TIME);
  assert.equal(row["depth imbalance"].value, "0");
  assert.equal(row["depth imbalance"].formula, "(bid depth - ask depth) / (bid depth + ask depth)");
  assert.equal(row.CVD.value, "1.5");
  assert.equal(row.CVD.formula, "cumulative taker buy minus taker sell");
  assert.equal(row.VWAP.value, null);
  assert.equal(row.VWAP.formula, "NOT IN SOURCE");
  assert.equal(row.VWAP.eventTime, null);
  assert.equal(row.volatility.value, null);
  assert.equal(row.volatility.formula, "NOT IN SOURCE");
  assert.equal(row["realized range"].value, null);
  assert.equal(row.funding.value, "0.0001");
  assert.equal(row.funding.eventTime, TIME);
  assert.equal(row["open interest"].value, "12");
  assert.equal(row.basis.value, null);
  assert.equal(row.liquidation.value, "5");
  for (const feature of balanced.features) {
    if (feature.value !== null) assert.equal(feature.eventTime, TIME);
  }

  const tilted = read({
    bidPrice: "0.0024",
    askPrice: "0.0026",
    bidDepth: "3",
    askDepth: "4",
  });
  assert.equal(byName(tilted).spread.value, "0.0002");
  assert.equal(byName(tilted)["depth imbalance"].value, "-1/7");
});

test("missing inputs stay missing and a stale watermark publishes no numbers", () => {
  const missing = read({
    askPrice: "0.0026",
    bidDepth: "0",
    askDepth: "0",
    trades: [{ side: "buy", quantity: "2" }, { side: "sell" }],
  });
  const row = byName(missing);
  assert.equal(row.spread.value, null);
  assert.equal(row["depth imbalance"].value, null);
  assert.equal(row.CVD.value, null);
  assert.equal(row.funding.value, null);
  assert.equal(row["open interest"].value, null);
  assert.equal(row.basis.value, null);
  assert.equal(row.liquidation.value, null);
  assert.equal(JSON.stringify(missing).includes("\"0\""), false);

  const explicitZero = read({ funding: "0" });
  assert.equal(byName(explicitZero).funding.value, "0");
  assert.equal(byName(explicitZero).basis.value, null);

  const equalBook = read({ bidPrice: "0.0025", askPrice: "0.0025" });
  assert.equal(byName(equalBook).spread.value, null);

  const stale = readMarketFeatures({
    eventTime: TIME + 1,
    sequence: 28457,
    sequenceWatermark: 28457,
    quality: HEALTHY,
    bidPrice: "0.0025",
    askPrice: "0.0026",
    funding: "0.0001",
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.inputWatermark, null);
  assert.equal(stale.sequenceWatermark, 28457);
  for (const feature of stale.features) {
    assert.equal(feature.value, null);
    assert.equal(feature.eventTime, null);
  }

  const badQuality = readMarketFeatures({
    eventTime: TIME,
    sequence: 28458,
    sequenceWatermark: null,
    quality: { healthy: false, reason: "stale stream" },
    bidPrice: "0.0025",
    askPrice: "0.0026",
  });
  assert.equal(badQuality.stale, true);
  assert.equal(byName(badQuality).spread.value, null);
});

test("paper mode stays locked and the module does not export an order", () => {
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(features, name), false);
  }
});
