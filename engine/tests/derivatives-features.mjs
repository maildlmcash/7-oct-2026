import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createContractStore, registerContract } from "../services/contract-specs.mjs";
import {
  DERIVATIVES_DIRECTION,
  DIVERGENCE_FORMULA,
  readDerivativesFeatures,
} from "../services/derivatives-features.mjs";
import * as features from "../services/derivatives-features.mjs";

const TIME = 1499865549590;
const HEALTHY = Object.freeze({ healthy: true, reason: null });

function contract(overrides) {
  return {
    id: "fixture-linear-perpetual",
    canonicalSymbol: "fixture-canonical",
    venueSymbol: "fixture-venue",
    base: "BTC",
    quote: "USDT",
    style: "linear",
    tenor: "perpetual",
    multiplier: "1",
    settlementCurrency: "USDT",
    tickSize: "0.5",
    lotSize: "1",
    markSource: "fixture-mark",
    indexSource: "fixture-index",
    expiry: null,
    fundingInterval: "8",
    ...overrides,
  };
}

function at(value, eventTime = TIME) {
  return { value, eventTime, quality: HEALTHY };
}

function byName(result, name) {
  return result.features.find((feature) => feature.name === name);
}

function storeWith(spec) {
  const store = createContractStore();
  const registered = registerContract(store, spec);
  assert.equal(registered.ok, true);
  return store;
}

test("derivatives features keep signs and units and funding does not set direction", () => {
  const linear = storeWith(contract({}));
  const full = readDerivativesFeatures(linear, {
    contractId: "fixture-linear-perpetual",
    funding: at("0.0001"),
    openInterest: at("12"),
    basis: at("-0.5"),
    mark: at("100.5", TIME + 1),
    index: at("100", TIME),
    liquidations: [
      { quantity: "3", eventTime: TIME + 2, quality: HEALTHY },
      { quantity: "2", eventTime: TIME, quality: HEALTHY },
    ],
    positionMode: { mode: "hedge", eventTime: TIME, quality: HEALTHY },
  });
  assert.equal(full.ok, true);
  assert.equal(full.blocked, null);
  assert.equal(full.direction, null);
  assert.equal(full.directionRule, DERIVATIVES_DIRECTION);
  assert.equal(byName(full, "funding").value, "0.0001");
  assert.equal(byName(full, "funding").unit, "funding rate");
  assert.equal(byName(full, "funding").eventTime, TIME);
  assert.deepEqual(byName(full, "funding").quality, HEALTHY);
  assert.equal(byName(full, "open interest").value, "12");
  assert.equal(byName(full, "open interest").unit, "BTC");
  assert.equal(byName(full, "basis").value, "-0.5");
  assert.equal(byName(full, "basis").unit, "source value");
  const divergence = byName(full, "mark/index divergence");
  assert.equal(divergence.value, "0.5");
  assert.equal(divergence.unit, "USDT");
  assert.equal(divergence.formula, DIVERGENCE_FORMULA);
  assert.equal(divergence.eventTime, TIME);
  assert.equal(divergence.markEventTime, TIME + 1);
  assert.equal(divergence.indexEventTime, TIME);
  assert.equal(byName(full, "liquidation").value, "5");
  assert.equal(byName(full, "liquidation").unit, "BTC");
  assert.equal(byName(full, "liquidation").eventTime, TIME);
  assert.equal(byName(full, "position mode").value, "hedge");
  assert.equal(byName(full, "position mode").unit, null);
  assert.deepEqual(readDerivativesFeatures(linear, structuredClone({
    contractId: "fixture-linear-perpetual",
    funding: at("0.0001"),
    openInterest: at("12"),
    basis: at("-0.5"),
    mark: at("100.5", TIME + 1),
    index: at("100", TIME),
    liquidations: [
      { quantity: "3", eventTime: TIME + 2, quality: HEALTHY },
      { quantity: "2", eventTime: TIME, quality: HEALTHY },
    ],
    positionMode: { mode: "hedge", eventTime: TIME, quality: HEALTHY },
  })), full);

  const negative = readDerivativesFeatures(linear, {
    contractId: "fixture-linear-perpetual",
    funding: at("-0.0001"),
    basis: at("0.5"),
    mark: at("99"),
    index: at("100"),
  });
  assert.equal(byName(negative, "funding").value, "-0.0001");
  assert.equal(byName(negative, "basis").value, "0.5");
  assert.equal(byName(negative, "mark/index divergence").value, "-1");
  assert.equal(negative.direction, null);

  const fundingOnly = readDerivativesFeatures(linear, {
    contractId: "fixture-linear-perpetual",
    funding: at("1"),
  });
  assert.equal(byName(fundingOnly, "funding").value, "1");
  assert.equal(byName(fundingOnly, "open interest").value, null);
  assert.equal(byName(fundingOnly, "basis").value, null);
  assert.equal(byName(fundingOnly, "mark/index divergence").value, null);
  assert.equal(byName(fundingOnly, "liquidation").value, null);
  assert.equal(byName(fundingOnly, "position mode").value, null);
  assert.equal(fundingOnly.direction, null);
  assert.equal(JSON.stringify(fundingOnly).includes("long"), false);

  const fundingZero = readDerivativesFeatures(linear, {
    contractId: "fixture-linear-perpetual",
    funding: at("0"),
  });
  assert.equal(byName(fundingZero, "funding").value, "0");
  assert.equal(fundingZero.direction, null);

  const inverse = storeWith(contract({
    id: "fixture-inverse-perpetual",
    style: "inverse",
    quote: "USD",
    settlementCurrency: "BTC",
  }));
  const inverseRead = readDerivativesFeatures(inverse, {
    contractId: "fixture-inverse-perpetual",
    openInterest: at("4"),
    mark: at("110"),
    index: at("100"),
    basis: at("-1"),
    positionMode: { mode: "one-way", eventTime: TIME, quality: HEALTHY },
  });
  assert.equal(byName(inverseRead, "open interest").unit, "contract");
  assert.equal(byName(inverseRead, "mark/index divergence").value, "10");
  assert.equal(byName(inverseRead, "mark/index divergence").unit, "USD");
  assert.equal(byName(inverseRead, "basis").value, "-1");
  assert.equal(byName(inverseRead, "position mode").value, "one-way");
  assert.equal(inverseRead.direction, null);
  assert.equal(linear.contracts.get("fixture-linear-perpetual").multiplier, "1");
});

test("missing quality, bad signs, and an unknown contract withhold the features", () => {
  const store = storeWith(contract({}));
  const unknown = readDerivativesFeatures(store, { contractId: "fixture-missing" });
  assert.equal(unknown.blocked, "BLOCKED");
  assert.equal(unknown.error, "contract is not configured");
  assert.equal(unknown.direction, null);
  assert.equal(unknown.features, null);

  const negativeInterest = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    openInterest: at("-12"),
  });
  assert.equal(negativeInterest.error, "open interest sign is not allowed");
  assert.equal(negativeInterest.features, null);
  assert.equal(JSON.stringify(negativeInterest).includes("-12"), false);

  const negativeLiquidation = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    liquidations: [{ quantity: "-5", eventTime: TIME, quality: HEALTHY }],
  });
  assert.equal(negativeLiquidation.error, "liquidation sign is not allowed");
  assert.equal(JSON.stringify(negativeLiquidation).includes("-5"), false);

  const negativePrice = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    mark: at("-1"),
    index: at("100"),
  });
  assert.equal(negativePrice.error, "price sign is not allowed");
  assert.equal(negativePrice.features, null);

  const mode = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    positionMode: { mode: "guessed", eventTime: TIME, quality: HEALTHY },
  });
  assert.equal(mode.error, "position mode is not supported");
  assert.equal(JSON.stringify(mode).includes("guessed"), false);

  const missingTime = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    basis: { value: "1", quality: HEALTHY },
  });
  assert.equal(missingTime.error, "source timestamp is not configured");
  assert.equal(missingTime.features, null);

  const degraded = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    funding: { value: "0.0001", eventTime: TIME, quality: "degraded" },
    mark: at("110"),
    index: at("100"),
  });
  assert.equal(degraded.ok, true);
  assert.equal(byName(degraded, "funding").value, null);
  assert.deepEqual(byName(degraded, "funding").quality, { healthy: false, reason: "degraded" });
  assert.equal(byName(degraded, "mark/index divergence").value, "10");
  assert.equal(degraded.direction, null);

  const unhealthyMark = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    funding: at("1"),
    mark: { value: "110", eventTime: TIME, quality: { healthy: false, reason: "stale mark" } },
    index: at("100"),
  });
  assert.equal(byName(unhealthyMark, "funding").value, "1");
  assert.equal(byName(unhealthyMark, "mark/index divergence").value, null);
  assert.equal(unhealthyMark.direction, null);

  const emptyEvents = readDerivativesFeatures(store, {
    contractId: "fixture-linear-perpetual",
    liquidations: [],
  });
  assert.equal(byName(emptyEvents, "liquidation").value, null);
  assert.equal(readDerivativesFeatures({ kind: "baseline", contracts: new Map() }, {
    contractId: "fixture-linear-perpetual",
  }).error, "contract is not configured");
});

test("the derivatives feature export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(features).sort(), [
    "DERIVATIVES_DIRECTION",
    "DIVERGENCE_FORMULA",
    "POSITION_MODES",
    "readDerivativesFeatures",
  ]);
  const source = readFileSync(new URL("../services/derivatives-features.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("NO_TRADE"), false);
  assert.equal(source.includes("ABSTAIN"), false);
  assert.equal(source.includes("S_fut"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
