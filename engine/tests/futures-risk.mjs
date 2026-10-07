import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createFuturesStore,
  registerFuturesLabel,
  registerFuturesModel,
  scoreFuturesModel,
} from "../services/futures-baseline.mjs";
import {
  FUTURES_RISK_ACTION,
  LIQUIDATION_DISTANCE_FORMULA,
  readFuturesRisk,
} from "../services/futures-risk.mjs";
import * as risk from "../services/futures-risk.mjs";

const TIME = 1499865549590;

function limits(overrides = {}) {
  return {
    leverage: "2",
    maxLeverage: "2",
    marginMode: "fixture-margin",
    notional: "10",
    maxNotional: "10",
    maintenanceMarginBuffer: "0.05",
    maintenanceMarginBufferFloor: "0.05",
    liquidationDistance: "0.2",
    liquidationDistanceFloor: "0.2",
    ...overrides,
  };
}

function features() {
  return {
    PriceTrend: "1",
    OIPriceImpulse: "1",
    TakerFlow: "1",
    FundingCrowding: "1",
    BasisSignal: "1",
    LiquidationFlow: "1",
    CrossVenueConfirmation: "1",
  };
}

test("caps at the boundary keep the supplied leverage and submit no order", () => {
  const input = limits({ leverage: "0.050", maintenanceMarginBuffer: "0.050" });
  input.maintenanceMarginBufferFloor = "0.05";
  const before = structuredClone(input);
  const first = readFuturesRisk(input);
  const second = readFuturesRisk(structuredClone(input));
  assert.deepEqual(input, before);
  assert.equal(first.ok, true);
  assert.equal(first.action, null);
  assert.equal(first.leverageAssumption, "0.050");
  assert.equal(first.maxLeverage, "2");
  assert.equal(first.marginMode, "fixture-margin");
  assert.equal(first.notional, "10");
  assert.equal(first.maintenanceMarginBuffer, "0.050");
  assert.equal(first.liquidationDistance, "0.2");
  assert.equal(first.liquidationDistanceFormula, LIQUIDATION_DISTANCE_FORMULA);
  assert.equal(first.leverageChanged, false);
  assert.equal(first.orderSubmitted, false);
  assert.deepEqual(second, first);

  const otherMode = readFuturesRisk(limits({ marginMode: "fixture-margin-2" }));
  assert.equal(otherMode.ok, true);
  assert.equal(otherMode.marginMode, "fixture-margin-2");
  assert.equal(otherMode.leverageAssumption, "2");

  const store = createFuturesStore();
  assert.equal(registerFuturesModel(store, {
    version: "fixture-futures",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: 60000,
  }).ok, true);
  assert.equal(registerFuturesLabel(store, {
    version: "fixture-futures-label",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: 60000,
  }).ok, true);
  const scored = scoreFuturesModel(store, { version: "fixture-futures", features: features() });
  const again = scoreFuturesModel(store, { version: "fixture-futures", features: features() });
  readFuturesRisk(limits());
  const after = scoreFuturesModel(store, { version: "fixture-futures", features: features() });
  assert.equal(scored.score, "100");
  assert.equal(Object.hasOwn(scored, "leverage"), false);
  assert.deepEqual(after, scored);
  assert.deepEqual(again, scored);
  assert.equal(store.outcomes.has(`fixture-futures-label\u0000${TIME}`), false);
});

test("a missing input or a failed cap abstains without rewriting leverage", () => {
  const above = limits({ leverage: "2.1" });
  const aboveBefore = structuredClone(above);
  const leverageFail = readFuturesRisk(above);
  assert.deepEqual(above, aboveBefore);
  assert.equal(leverageFail.action, FUTURES_RISK_ACTION);
  assert.equal(leverageFail.error, "leverage cap is exceeded");
  assert.equal(leverageFail.leverageAssumption, "2.1");
  assert.equal(leverageFail.maxLeverage, "2");
  assert.equal(leverageFail.leverageChanged, false);
  assert.equal(leverageFail.orderSubmitted, false);

  const notionalFail = readFuturesRisk(limits({ notional: "10.1" }));
  assert.equal(notionalFail.action, FUTURES_RISK_ACTION);
  assert.equal(notionalFail.error, "notional cap is exceeded");
  assert.equal(notionalFail.notional, "10.1");
  assert.equal(notionalFail.leverageAssumption, "2");

  const bufferFail = readFuturesRisk(limits({ maintenanceMarginBuffer: "0.049" }));
  assert.equal(bufferFail.error, "maintenance-margin buffer is not met");
  assert.equal(bufferFail.action, FUTURES_RISK_ACTION);
  assert.equal(bufferFail.maintenanceMarginBuffer, "0.049");

  const distanceFail = readFuturesRisk(limits({ liquidationDistance: "0.199" }));
  assert.equal(distanceFail.error, "liquidation distance is below the floor");
  assert.equal(distanceFail.action, FUTURES_RISK_ACTION);
  assert.equal(distanceFail.liquidationDistance, "0.199");
  assert.equal(distanceFail.liquidationDistanceFormula, LIQUIDATION_DISTANCE_FORMULA);

  const zero = readFuturesRisk(limits({ leverage: "0", maxLeverage: "0" }));
  assert.equal(zero.ok, true);
  assert.equal(zero.leverageAssumption, "0");

  const blankLeverage = readFuturesRisk(limits({ leverage: "" }));
  assert.equal(blankLeverage.error, "leverage is not configured");
  assert.equal(blankLeverage.action, FUTURES_RISK_ACTION);
  assert.equal(blankLeverage.leverageAssumption, null);

  const blankMode = readFuturesRisk(limits({ marginMode: "   " }));
  assert.equal(blankMode.error, "margin mode is not configured");
  assert.equal(blankMode.marginMode, null);
  assert.equal(blankMode.leverageAssumption, "2");

  const blankDistance = readFuturesRisk(limits({ liquidationDistance: "" }));
  assert.equal(blankDistance.error, "liquidation distance is not configured");
  assert.equal(blankDistance.liquidationDistance, null);

  const withoutLeverage = limits();
  delete withoutLeverage.leverage;
  const missing = readFuturesRisk(withoutLeverage);
  assert.equal(missing.error, "unsupported field");
  assert.equal(missing.action, FUTURES_RISK_ACTION);
  assert.equal(missing.leverageAssumption, null);

  const scored = limits({ score: "100" });
  const mixed = readFuturesRisk(scored);
  assert.equal(mixed.error, "unsupported field");
  assert.equal(mixed.leverageAssumption, null);
  assert.equal(JSON.stringify(mixed).includes("100"), false);

  const negative = readFuturesRisk(limits({ leverage: "-1" }));
  assert.equal(negative.error, "unsupported field");
  assert.equal(negative.leverageAssumption, null);
  assert.equal(JSON.stringify(negative).includes("-1"), false);
});

test("the futures risk export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(risk).sort(), [
    "FUTURES_RISK_ACTION",
    "LIQUIDATION_DISTANCE_FORMULA",
    "readFuturesRisk",
  ]);
  const source = readFileSync(new URL("../services/futures-risk.mjs", import.meta.url), "utf8");
  const model = readFileSync(new URL("../services/futures-baseline.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("submitOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(model.includes("NO_TRADE"), false);
  assert.equal(model.includes("readFuturesRisk"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
