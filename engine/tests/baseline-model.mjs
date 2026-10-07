import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as baseline from "../services/baseline-model.mjs";
import {
  BASELINE_FEATURES,
  BASELINE_FORMULA,
  BASELINE_WEIGHTS,
  createBaselineStore,
  registerBaselineModel,
  scoreBaselineModel,
} from "../services/baseline-model.mjs";

// fixture-baseline is a caller fixture. The source names no model version id.
const VERSION = "fixture-baseline";
const OTHER = "fixture-baseline-2";

function features(value, overrides = {}) {
  const row = {};
  for (const name of BASELINE_FEATURES) row[name] = value;
  return { ...row, ...overrides };
}

function score(store, value, overrides = {}, version = VERSION) {
  return scoreBaselineModel(store, { version, features: features(value, overrides) });
}

test("signed weights are deterministic and stay distinct from probability", () => {
  const store = createBaselineStore();
  const registered = registerBaselineModel(store, { version: VERSION });
  const again = registerBaselineModel(store, { version: VERSION });
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.modelVersion, VERSION);
  assert.equal(registered.formula, BASELINE_FORMULA);
  assert.equal(registered.score, null);
  assert.equal(registered.calibratedProbability, null);
  assert.deepEqual(again, registered);
  assert.equal(store.versions.size, 1);

  const second = registerBaselineModel(store, { version: OTHER });
  assert.equal(second.ok, true, second.error);
  assert.equal(second.modelVersion, OTHER);
  assert.equal(store.versions.size, 2);

  const up = score(store, "1");
  const upAgain = scoreBaselineModel(store, structuredClone({
    version: VERSION,
    features: features("1"),
  }));
  assert.equal(up.ok, true, up.error);
  assert.equal(up.score, "100");
  assert.equal(up.calibratedProbability, null);
  assert.equal(up.formula, BASELINE_FORMULA);
  assert.notEqual(up.score, up.calibratedProbability);
  assert.deepEqual(upAgain, up);

  assert.equal(score(store, "-1").score, "-100");
  assert.equal(score(store, "0").score, "0");
  assert.equal(score(store, "0", { OBI: "-0" }).score, "0");
  assert.equal(score(store, "0", { OBI: "1" }).score, "22");
  assert.equal(score(store, "0", { OBI: "-1" }).score, "-22");
  assert.equal(score(store, "0", { OBI: "1", CVD: "-1" }).score, "2");
  assert.equal(score(store, "0", { OBI: "1", CVD: "-1", TradeImbalance: "-1" }).score, "-14");
  assert.equal(score(store, "0", { OBI: "-1/7" }).score, "-22/7");
  assert.equal(score(store, "0", { OBI: "1/2" }).score, "11");

  const other = score(store, "0", { OBI: "1" }, OTHER);
  assert.equal(other.ok, true, other.error);
  assert.equal(other.score, "22");
  assert.equal(other.modelVersion, OTHER);
  assert.equal(other.formula, up.formula);
  assert.notEqual(other.modelVersion, up.modelVersion);
  assert.equal(other.calibratedProbability, null);

  const missingVersion = scoreBaselineModel(store, { version: "missing-version", features: features("1") });
  assert.equal(missingVersion.ok, false);
  assert.equal(missingVersion.blocked, "BLOCKED");
  assert.equal(missingVersion.error, "model version is not configured");
  assert.equal(missingVersion.score, null);
  assert.equal(missingVersion.calibratedProbability, null);

  const retune = registerBaselineModel(store, { version: VERSION, weights: { OBI: 99 } });
  assert.equal(retune.error, "unsupported field");
  assert.equal(retune.score, null);
  assert.equal(JSON.stringify(retune).includes("99"), false);
  const weighted = scoreBaselineModel(store, {
    version: VERSION,
    features: features("1"),
    weights: { OBI: 1 },
  });
  assert.equal(weighted.error, "unsupported field");
  assert.equal(weighted.score, null);
  assert.equal(score(store, "0", { OBI: "1" }).score, "22");
  assert.equal(store.versions.size, 2);
  assert.equal(registerBaselineModel(store, { version: "" }).error, "model version is not configured");
  assert.equal(registerBaselineModel(store, { version: "  " }).error, "model version is not configured");
});

test("null signed features stay null and out-of-range components are clipped", () => {
  const store = createBaselineStore();
  registerBaselineModel(store, { version: VERSION });

  const missing = score(store, "1", { OBI: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "signed feature is missing");
  assert.equal(missing.score, null);
  assert.equal(missing.calibratedProbability, null);
  assert.equal(missing.formula, BASELINE_FORMULA);
  assert.equal(JSON.stringify(missing).includes("78"), false);

  const row = features("1");
  delete row.OBI;
  const absent = scoreBaselineModel(store, { version: VERSION, features: row });
  assert.equal(absent.error, "signed feature is missing");
  assert.equal(absent.score, null);
  assert.equal(JSON.stringify(absent).includes("78"), false);

  assert.equal(score(store, "1", { CVD: "" }).error, "signed feature is missing");
  assert.equal(score(store, "1", { CVD: "   " }).error, "signed feature is missing");
  assert.equal(score(store, "1", { WhaleVerifiedFlow: null }).score, null);

  assert.equal(score(store, "0", { OBI: "1" }).score, "22");
  assert.equal(score(store, "0", { OBI: "1.0" }).score, "22");
  assert.equal(score(store, "0", { OBI: "2" }).score, "22");
  assert.equal(score(store, "0", { OBI: "3/2" }).score, "22");
  assert.equal(score(store, "0", { OBI: "-1" }).score, "-22");
  assert.equal(score(store, "0", { OBI: "-1.0" }).score, "-22");
  assert.equal(score(store, "0", { OBI: "-1.5" }).score, "-22");
  assert.equal(score(store, "0", { OBI: "-3" }).score, "-22");
  assert.equal(score(store, "2").score, "100");
  assert.equal(score(store, "-3").score, "-100");

  const guessed = score(store, "0", { TrendRegime: "guessed" });
  assert.equal(guessed.error, "unsupported field");
  assert.equal(guessed.score, null);
  assert.equal(guessed.calibratedProbability, null);
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);

  const named = score(store, "0", { OBI: "up" });
  assert.equal(named.error, "unsupported field");
  assert.equal(named.score, null);
  assert.equal(named.calibratedProbability, null);

  const numeric = score(store, "0", { OBI: 1 });
  assert.equal(numeric.error, "unsupported field");
  assert.equal(numeric.score, null);

  const extra = features("0");
  extra.zscore = "1";
  const unknown = scoreBaselineModel(store, { version: VERSION, features: extra });
  assert.equal(unknown.error, "unsupported field");
  assert.equal(unknown.score, null);
  assert.equal(JSON.stringify(unknown).includes("zscore"), false);

  assert.equal(scoreBaselineModel(store, { version: VERSION, features: [] }).error, "unsupported field");
  assert.equal(score(store, "0", { DEXNetFlow: "1/0" }).error, "unsupported field");
});

test("the baseline export is closed and the model card states use and limitations", () => {
  assert.deepEqual(Object.keys(baseline).sort(), [
    "BASELINE_FEATURES",
    "BASELINE_FORMULA",
    "BASELINE_WEIGHTS",
    "createBaselineStore",
    "registerBaselineModel",
    "scoreBaselineModel",
  ]);
  assert.deepEqual(BASELINE_FEATURES, [
    "OBI",
    "CVD",
    "TradeImbalance",
    "TrendRegime",
    "DEXNetFlow",
    "WhaleVerifiedFlow",
    "CrossVenueBreadth",
  ]);
  assert.equal(Object.values(BASELINE_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
  assert.equal(Object.isFrozen(BASELINE_WEIGHTS), true);
  assert.equal(BASELINE_FORMULA.includes("0.22*OBI"), true);
  assert.equal(BASELINE_FORMULA.includes("0.06*CrossVenueBreadth"), true);

  const source = readFileSync(new URL("../services/baseline-model.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("NO_TRADE"), false);
  assert.equal(source.includes("ABSTAIN"), false);
  assert.equal(source.includes("S_fut"), false);
  assert.equal(source.includes("calibratedProbability"), true);

  const card = readFileSync(new URL("../docs/model-cards/spot-baseline.md", import.meta.url), "utf8");
  assert.equal(card.includes("## Intended use"), true);
  assert.equal(card.includes("## Limitations"), true);
  assert.equal(card.includes("0.22"), true);
  assert.equal(card.includes("0.20"), true);
  assert.equal(card.includes("0.16"), true);
  assert.equal(card.includes("0.14"), true);
  assert.equal(card.includes("0.12"), true);
  assert.equal(card.includes("0.10"), true);
  assert.equal(card.includes("0.06"), true);
  assert.equal(card.includes("WhaleVerifiedFlow"), true);
  assert.equal(card.includes("CrossVenueBreadth"), true);
  assert.equal(card.includes("calibratedProbability"), true);
  assert.equal(card.includes("NOT IN SOURCE"), true);
  assert.equal(card.includes("Live trading stays OFF"), true);
  assert.equal(card.includes("clip"), true);

  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
