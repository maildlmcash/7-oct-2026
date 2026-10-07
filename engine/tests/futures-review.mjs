import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  FUTURES_FEATURES,
  FUTURES_FORMULA,
  FUTURES_NET,
  createFuturesStore,
  evaluateFuturesWalkForward,
  pinFuturesManifest,
  registerFuturesLabel,
  registerFuturesModel,
  scoreFuturesModel,
} from "../services/futures-baseline.mjs";
import * as faults from "../services/futures-faults.mjs";
import * as review from "../services/futures-review.mjs";
import { FUTURES_PREDICTION_SUPPRESSED } from "../services/futures-faults.mjs";
import { FUTURES_RISK_ACTION } from "../services/futures-risk.mjs";
import {
  approveFuturesReview,
  createFuturesReviewStore,
  readFuturesReview,
  registerFuturesReview,
} from "../services/futures-review.mjs";

const TIME = 1499865549590;
const DURATION = 60000;
const DAY = 86400000;
const VERSION = "fixture-review-1";
const CHANGED = "2026-10-06T00:00:00Z";
const CARD = "docs/model-cards/futures-baseline.md";
const RISK = "docs/risk-reviews/futures-baseline.md";
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

const maker = { id: "fixture-maker", role: "Admin", tenantId: "tenant-1" };
const modelApprover = { id: "fixture-model-approver", role: "Admin", tenantId: "tenant-1" };
const riskApprover = { id: "fixture-risk-approver", role: "Admin", tenantId: "tenant-1" };
const customer = { id: "fixture-customer", role: "Customer", tenantId: "tenant-1" };
const otherTenant = { id: "fixture-other", role: "Admin", tenantId: "tenant-2" };

function signed(value) {
  const row = {};
  for (const name of FUTURES_FEATURES) row[name] = value;
  return row;
}

function bound() {
  const store = createFuturesStore();
  assert.equal(registerFuturesModel(store, {
    version: "fixture-futures",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: DURATION,
  }).ok, true);
  assert.equal(registerFuturesLabel(store, {
    version: "fixture-futures-label",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: DURATION,
  }).ok, true);
  return store;
}

function manifest() {
  const cutoff = TIME;
  return {
    datasetId: "fixture-dataset",
    modelVersion: "fixture-futures",
    featureVersion: "fixture-features",
    labelVersion: "fixture-futures-label",
    contractFamily: "linear",
    horizon: "fixture-horizon",
    duration: DURATION,
    window: { from: TIME, to: TIME + DAY },
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
    rows: [{
      name: "row-1",
      fold: "fold-1",
      regime: "fixture-regime",
      features: signed("1"),
      leakage: {
        receiveTime: cutoff + 1,
        lagThreshold: 1000,
        features: [{
          name: "spread",
          source: "fixture-source",
          eventTime: cutoff,
          window: { from: cutoff, to: cutoff },
          quality: { healthy: true, reason: null },
        }],
      },
      label: {
        cutoff,
        start: { mark: "100", time: cutoff },
        outcome: { mark: "101", time: cutoff + DURATION },
        quality: { healthy: true, reason: null },
      },
      cost: {
        bids: BIDS.map((level) => [...level]),
        asks: ASKS.map((level) => [...level]),
        quantity: "3",
        feeRate: "0.001",
      },
      funding: "0.01",
      liquidation: "0",
      benchmarkNet: "0",
    }],
  };
}

function evaluationOf() {
  const futures = bound();
  const before = scoreFuturesModel(futures, { version: "fixture-futures", features: signed("1") });
  const pinned = pinFuturesManifest(manifest());
  assert.equal(pinned.ok, true, pinned.error);
  const first = evaluateFuturesWalkForward({ futures, manifest: pinned.manifest });
  const second = evaluateFuturesWalkForward({
    futures,
    manifest: structuredClone(pinned.manifest),
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.product, "futures");
  assert.equal(first.formula, FUTURES_FORMULA);
  assert.equal(first.netPerformance.formula, FUTURES_NET);
  assert.equal(first.netPerformance.value, "-541/25500");
  assert.equal(first.sampleSize >= 1, true);
  assert.deepEqual(second, first);
  return { futures, before, pinned, first };
}

function registration(evaluation, versionId = VERSION, rollback = { priorVersionId: null, reason: "no earlier paper version" }) {
  return {
    actor: maker,
    versionId,
    modelVersion: evaluation.modelVersion,
    featureVersion: evaluation.featureVersion,
    datasetId: evaluation.datasetId,
    labelVersion: evaluation.labelVersion,
    horizon: evaluation.horizon,
    duration: evaluation.duration,
    contractFamily: evaluation.contractFamily,
    modelCard: { path: CARD },
    riskReview: { path: RISK },
    evaluation,
    rollback,
  };
}

test("absent model or risk approval stays blocked until two distinct approvers", () => {
  const { futures, before, pinned, first } = evaluationOf();
  const store = createFuturesReviewStore();
  const evaluation = {
    ...first,
    spotBid: "spot-bid-marker",
    spotScore: "spot-score-marker",
  };
  const registered = registerFuturesReview(store, registration(evaluation));
  assert.equal(registered.ok, false);
  assert.equal(registered.blocked, "BLOCKED");
  assert.equal(registered.error, "model approval is not configured");
  assert.equal(registered.paperExecution, false);
  assert.equal(registered.enabled, false);
  assert.equal(registered.ordersSubmitted, false);
  assert.equal(registered.checklist.modelApprover, null);
  assert.equal(registered.checklist.riskApprover, null);
  assert.equal(store.reviews.size, 1);

  const again = registerFuturesReview(store, registration(evaluation));
  assert.equal(again.blocked, "BLOCKED");
  assert.equal(again.error, "model approval is not configured");
  assert.equal(again.paperExecution, false);
  assert.equal(store.reviews.size, 1);

  const unread = readFuturesReview(store, { actor: maker, versionId: VERSION });
  assert.equal(unread.blocked, "BLOCKED");
  assert.equal(unread.error, "model approval is not configured");
  assert.equal(unread.paperExecution, false);
  assert.equal(unread.enabled, false);
  assert.equal(unread.ordersSubmitted, false);

  const makerApprove = approveFuturesReview(store, {
    actor: maker,
    versionId: VERSION,
    approval: "model",
    changedAt: CHANGED,
  });
  assert.equal(makerApprove.blocked, "BLOCKED");
  assert.equal(makerApprove.error, "maker cannot approve");
  assert.equal(makerApprove.paperExecution, false);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: VERSION }).checklist.modelApprover, null);

  const modelOnly = approveFuturesReview(store, {
    actor: modelApprover,
    versionId: VERSION,
    approval: "model",
    changedAt: CHANGED,
  });
  assert.equal(modelOnly.blocked, "BLOCKED");
  assert.equal(modelOnly.error, "risk approval is not configured");
  assert.equal(modelOnly.paperExecution, false);
  assert.equal(modelOnly.enabled, false);
  assert.equal(modelOnly.ordersSubmitted, false);
  assert.equal(modelOnly.checklist.modelApprover, "fixture-model-approver");
  assert.equal(modelOnly.checklist.riskApprover, null);

  const samePerson = approveFuturesReview(store, {
    actor: modelApprover,
    versionId: VERSION,
    approval: "risk",
    changedAt: CHANGED,
  });
  assert.equal(samePerson.blocked, "BLOCKED");
  assert.equal(samePerson.error, "approvers are not distinct");
  const still = readFuturesReview(store, { actor: maker, versionId: VERSION });
  assert.equal(still.blocked, "BLOCKED");
  assert.equal(still.error, "risk approval is not configured");
  assert.equal(still.checklist.modelApprover, "fixture-model-approver");
  assert.equal(still.checklist.riskApprover, null);
  assert.equal(still.paperExecution, false);

  const accepted = approveFuturesReview(store, {
    actor: riskApprover,
    versionId: VERSION,
    approval: "risk",
    changedAt: CHANGED,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.blocked, null);
  assert.equal(accepted.error, null);
  assert.equal(accepted.paperExecution, false);
  assert.equal(accepted.enabled, false);
  assert.equal(accepted.ordersSubmitted, false);
  assert.equal(accepted.checklist.distinctApprovers, true);
  assert.equal(accepted.checklist.modelCard, true);
  assert.equal(accepted.checklist.riskReview, true);
  assert.equal(accepted.checklist.evaluation, true);
  assert.equal(accepted.checklist.rollback, true);
  assert.equal(accepted.checklist.modelApprover, "fixture-model-approver");
  assert.equal(accepted.checklist.riskApprover, "fixture-risk-approver");

  const read = readFuturesReview(store, { actor: maker, versionId: VERSION });
  assert.deepEqual(read, accepted);
  const body = JSON.stringify(read);
  assert.equal(body.includes("spot-bid-marker"), false);
  assert.equal(body.includes("spot-score-marker"), false);
  assert.equal(body.includes("0.0025"), false);
  assert.equal(body.includes('"paperExecution":true'), false);
  assert.equal(body.includes('"enabled":true'), false);
  assert.equal(body.includes('"ordersSubmitted":true'), false);

  const after = scoreFuturesModel(futures, { version: "fixture-futures", features: signed("1") });
  assert.deepEqual(after, before);
  const third = evaluateFuturesWalkForward({
    futures,
    manifest: structuredClone(pinned.manifest),
  });
  assert.deepEqual(third, first);
});

test("a spot report, a shared approver, and a missing record stay blocked", () => {
  const { first } = evaluationOf();
  const store = createFuturesReviewStore();
  const spot = registerFuturesReview(store, registration({
    ...first,
    product: "spot",
    spotScore: "spot-score-marker",
  }, "fixture-review-spot"));
  assert.equal(spot.blocked, "BLOCKED");
  assert.equal(spot.error, "evaluation does not match the model");
  assert.equal(spot.checklist, null);
  assert.equal(spot.paperExecution, false);
  assert.equal(JSON.stringify(spot).includes("spot-score-marker"), false);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: "fixture-review-spot" }).error, "review is not configured");

  const denied = registerFuturesReview(store, { ...registration(first, "fixture-review-customer"), actor: customer });
  assert.equal(denied.blocked, "BLOCKED");
  assert.equal(denied.error, "role scope denied");
  assert.equal(denied.checklist, null);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: "fixture-review-customer" }).error, "review is not configured");

  const missingRollback = registerFuturesReview(store, {
    ...registration(first, "fixture-review-rollback"),
    rollback: undefined,
  });
  assert.equal(missingRollback.blocked, "BLOCKED");
  assert.equal(missingRollback.paperExecution, false);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: "fixture-review-rollback" }).error, "review is not configured");

  const blankReason = registerFuturesReview(store, registration(first, "fixture-review-reason", {
    priorVersionId: null,
    reason: " ",
  }));
  assert.equal(blankReason.blocked, "BLOCKED");
  assert.equal(blankReason.error, "rollback record is not configured");

  const spotCard = registerFuturesReview(store, {
    ...registration(first, "fixture-review-card"),
    modelCard: { path: "docs/model-cards/spot-baseline.md" },
  });
  assert.equal(spotCard.blocked, "BLOCKED");
  assert.equal(spotCard.error, "unsupported field");
  assert.equal(JSON.stringify(spotCard).includes("spot-baseline"), false);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: "fixture-review-card" }).error, "review is not configured");

  const sameVersion = registerFuturesReview(store, registration(first, "fixture-review-same", {
    priorVersionId: "fixture-review-same",
    reason: "same version",
  }));
  assert.equal(sameVersion.blocked, "BLOCKED");
  assert.equal(sameVersion.error, "rollback record is not configured");
  assert.equal(readFuturesReview(store, { actor: maker, versionId: "fixture-review-same" }).error, "review is not configured");

  const registered = registerFuturesReview(store, registration(first));
  assert.equal(registered.error, "model approval is not configured");
  const replaced = registerFuturesReview(store, registration(first, VERSION, {
    priorVersionId: null,
    reason: "different reason",
  }));
  assert.equal(replaced.blocked, "BLOCKED");
  assert.equal(replaced.error, "review is already registered");
  assert.equal(store.reviews.size, 1);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: VERSION }).error, "model approval is not configured");

  const cross = readFuturesReview(store, { actor: otherTenant, versionId: VERSION });
  assert.equal(cross.blocked, "BLOCKED");
  assert.equal(cross.error, "role scope denied");
  assert.equal(cross.checklist, null);
  const customerRead = readFuturesReview(store, { actor: customer, versionId: VERSION });
  assert.equal(customerRead.error, "role scope denied");
  assert.equal(customerRead.checklist, null);

  const guessed = approveFuturesReview(store, {
    actor: modelApprover,
    versionId: VERSION,
    approval: "guessed",
    changedAt: CHANGED,
  });
  assert.equal(guessed.blocked, "BLOCKED");
  assert.equal(guessed.error, "unsupported field");
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);
  assert.equal(readFuturesReview(store, { actor: maker, versionId: VERSION }).checklist.modelApprover, null);
});

test("the futures review export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(review).sort(), [
    "approveFuturesReview",
    "createFuturesReviewStore",
    "readFuturesReview",
    "registerFuturesReview",
  ]);
  const source = readFileSync(new URL("../services/futures-review.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("readMarketFeatures"), false);
  for (const path of [
    "../services/futures-baseline.mjs",
    "../services/futures-risk.mjs",
    "../services/futures-faults.mjs",
    "../services/model-registry.mjs",
  ]) {
    const body = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(body.includes("registerFuturesReview"), false, path);
  }
  const card = readFileSync(new URL(`../${CARD}`, import.meta.url), "utf8");
  assert.equal(card.includes(FUTURES_FORMULA), true);
  assert.equal(card.includes("Live trading stays OFF"), true);
  const risk = readFileSync(new URL(`../${RISK}`, import.meta.url), "utf8");
  assert.equal(risk.includes(FUTURES_RISK_ACTION), true);
  for (const fault of Object.keys(FUTURES_PREDICTION_SUPPRESSED)) {
    assert.equal(risk.includes(fault), true, fault);
  }
  assert.equal(faults.FUTURES_PREDICTION_SUPPRESSED["liquidation-feed outage"], true);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
