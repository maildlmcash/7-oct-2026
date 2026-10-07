import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createFuturesStore, registerFuturesModel, scoreFuturesModel } from "../services/futures-baseline.mjs";
import {
  FUTURES_FAULT_STATES,
  FUTURES_FAULTS,
  FUTURES_PREDICTION_SUPPRESSED,
  evaluateFuturesFaults,
} from "../services/futures-faults.mjs";
import * as faults from "../services/futures-faults.mjs";

const TIME = 1499865549590;
const LAG = 1000;

function feed(overrides = {}) {
  return {
    value: "100",
    eventTime: TIME,
    sequence: "2",
    sequenceWatermark: "1",
    quality: { healthy: true, reason: null },
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    asOf: TIME,
    receiveTime: TIME + 1,
    lagThreshold: LAG,
    mark: feed(),
    index: feed({ sequence: "4", sequenceWatermark: "3" }),
    funding: feed({ value: "0.0001", sequence: "9", sequenceWatermark: "8" }),
    openInterest: feed({
      value: "1000000",
      sequence: "6",
      sequenceWatermark: "5",
      discontinuity: false,
    }),
    liquidationFeed: {
      status: "available",
      eventTime: TIME,
      quality: { healthy: true, reason: null },
      events: [],
    },
    prediction: { product: "futures", score: "14" },
    spot: { product: "spot", bid: "0.0025", ask: "0.0026", score: "22" },
    ...overrides,
  };
}

test("a healthy futures feed keeps the futures score and ignores spot", () => {
  const input = observation();
  const before = structuredClone(input);
  const first = evaluateFuturesFaults(input);
  const second = evaluateFuturesFaults(structuredClone(input));
  assert.deepEqual(input, before);
  assert.equal(first.ok, true);
  assert.equal(first.state, null);
  assert.equal(first.suppressed, false);
  assert.equal(first.product, "futures");
  assert.equal(first.score, "14");
  assert.equal(first.prediction.score, "14");
  assert.equal(first.spotFallback, false);
  assert.equal(first.alerts.length, 0);
  assert.equal(JSON.stringify(first).includes("0.0025"), false);
  assert.equal(JSON.stringify(first).includes("\"22\""), false);
  assert.deepEqual(second, first);

  const boundary = observation({ receiveTime: TIME + LAG });
  assert.equal(evaluateFuturesFaults(boundary).suppressed, false);

  const store = createFuturesStore();
  assert.equal(registerFuturesModel(store, {
    version: "fixture-futures",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: 60000,
  }).ok, true);
  const features = {
    PriceTrend: "1",
    OIPriceImpulse: "0",
    TakerFlow: "0",
    FundingCrowding: "0",
    BasisSignal: "0",
    LiquidationFlow: "0",
    CrossVenueConfirmation: "0",
  };
  const scored = scoreFuturesModel(store, { version: "fixture-futures", features });
  const carried = evaluateFuturesFaults(observation({
    prediction: { product: "futures", score: scored.score },
  }));
  const again = scoreFuturesModel(store, { version: "fixture-futures", features });
  assert.equal(scored.score, "18");
  assert.equal(carried.score, "18");
  assert.deepEqual(again, scored);
});

test("each injected futures fault abstains or degrades and withholds the score", () => {
  const late = observation({
    mark: feed({ eventTime: TIME - LAG - 1 }),
  });
  const lateResult = evaluateFuturesFaults(late);
  assert.equal(lateResult.state, "abstain");
  assert.equal(lateResult.suppressed, true);
  assert.equal(lateResult.score, null);
  assert.equal(lateResult.prediction, null);
  assert.equal(lateResult.spotFallback, false);
  assert.deepEqual(lateResult.alerts, [{
    fault: "stale mark/index",
    state: "abstain",
    source: "mark",
    suppressed: true,
    reason: "late event",
  }]);
  assert.equal(JSON.stringify(lateResult).includes("0.0025"), false);

  const marked = observation({
    mark: feed({ quality: { healthy: false, reason: "stale stream" } }),
  });
  const markedResult = evaluateFuturesFaults(marked);
  assert.equal(markedResult.alerts[0].fault, "stale mark/index");
  assert.equal(markedResult.alerts[0].source, "mark");
  assert.equal(markedResult.alerts[0].reason, "stale stream");
  assert.equal(markedResult.score, null);

  const repeated = observation({
    mark: feed({ sequence: "5", sequenceWatermark: "5" }),
  });
  assert.equal(evaluateFuturesFaults(repeated).alerts[0].reason, "stale stream");

  const gap = observation({
    funding: feed({ value: "0.0001", sequence: "10", sequenceWatermark: "8" }),
  });
  const gapResult = evaluateFuturesFaults(gap);
  assert.equal(gapResult.state, "abstain");
  assert.deepEqual(gapResult.alerts, [{
    fault: "funding gap",
    state: "abstain",
    source: "funding",
    suppressed: true,
    reason: "sequence gap",
  }]);
  assert.equal(gapResult.score, null);

  const staleFunding = observation({
    funding: feed({
      value: "0.0001",
      sequence: "9",
      sequenceWatermark: "8",
      quality: { healthy: false, reason: "stale stream" },
    }),
  });
  const staleFundingResult = evaluateFuturesFaults(staleFunding);
  assert.equal(staleFundingResult.alerts[0].fault, "stale funding");
  assert.equal(staleFundingResult.alerts[0].state, "abstain");
  assert.equal(staleFundingResult.score, null);

  const broken = observation();
  broken.openInterest = feed({
    value: "1000000",
    sequence: "6",
    sequenceWatermark: "5",
    discontinuity: true,
  });
  const brokenResult = evaluateFuturesFaults(broken);
  assert.equal(brokenResult.state, "abstain");
  assert.equal(brokenResult.alerts[0].fault, "open-interest discontinuity");
  assert.equal(brokenResult.alerts[0].source, "open interest");
  assert.equal(brokenResult.score, null);
  assert.equal(JSON.stringify(brokenResult).includes("1000000"), false);

  const outage = observation({
    liquidationFeed: {
      status: "outage",
      eventTime: TIME,
      quality: { healthy: true, reason: null },
    },
  });
  const outageResult = evaluateFuturesFaults(outage);
  assert.equal(outageResult.state, "degraded");
  assert.equal(outageResult.suppressed, true);
  assert.deepEqual(outageResult.alerts, [{
    fault: "liquidation-feed outage",
    state: "degraded",
    source: "liquidation",
    suppressed: true,
    reason: "outage",
  }]);
  assert.equal(outageResult.score, null);
  assert.equal(outageResult.product, null);

  const spotPrediction = observation({
    prediction: { product: "spot", score: "22" },
  });
  const rejected = evaluateFuturesFaults(spotPrediction);
  assert.equal(rejected.error, "prediction product is not futures");
  assert.equal(rejected.score, null);
  assert.equal(rejected.spotFallback, false);
  assert.equal(JSON.stringify(rejected).includes("22"), false);

  const combined = observation({
    mark: feed({ quality: { healthy: false, reason: "stale stream" } }),
    funding: feed({ value: "0.0001", sequence: "10", sequenceWatermark: "8" }),
    liquidationFeed: { status: "outage", eventTime: TIME, quality: { healthy: true, reason: null } },
  });
  combined.openInterest = feed({
    value: "12",
    sequence: "6",
    sequenceWatermark: "5",
    discontinuity: true,
  });
  const all = evaluateFuturesFaults(combined);
  assert.equal(all.state, "abstain");
  assert.deepEqual(all.alerts.map((item) => item.fault), [
    "stale mark/index",
    "funding gap",
    "open-interest discontinuity",
    "liquidation-feed outage",
  ]);
  assert.equal(all.score, null);
  assert.equal(JSON.stringify(all).includes("0.0025"), false);

  const guessed = observation({
    mark: feed({ quality: { healthy: false, reason: "guessed" } }),
  });
  assert.equal(JSON.stringify(evaluateFuturesFaults(guessed)).includes("guessed"), false);
});

test("the futures fault export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(faults).sort(), [
    "FUTURES_FAULTS",
    "FUTURES_FAULT_STATES",
    "FUTURES_PREDICTION_SUPPRESSED",
    "evaluateFuturesFaults",
  ]);
  assert.deepEqual(FUTURES_FAULTS, [
    "stale mark/index",
    "funding gap",
    "open-interest discontinuity",
    "liquidation-feed outage",
  ]);
  for (const fault of Object.keys(FUTURES_PREDICTION_SUPPRESSED)) {
    assert.equal(FUTURES_PREDICTION_SUPPRESSED[fault], true);
    assert.equal(typeof FUTURES_FAULT_STATES[fault], "string");
  }
  const source = readFileSync(new URL("../services/futures-faults.mjs", import.meta.url), "utf8");
  const model = readFileSync(new URL("../services/futures-baseline.mjs", import.meta.url), "utf8");
  const spotFeatures = readFileSync(new URL("../services/market-features.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("readMarketFeatures"), false);
  assert.equal(model.includes("evaluateFuturesFaults"), false);
  assert.equal(spotFeatures.includes("evaluateFuturesFaults"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
