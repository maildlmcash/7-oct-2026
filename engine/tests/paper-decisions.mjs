import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  BASELINE_FEATURES,
  BASELINE_FORMULA,
  createBaselineStore,
  registerBaselineModel,
} from "../services/baseline-model.mjs";
import { readExecutionCost } from "../services/execution-costs.mjs";
import { createPaperDecisionStore, decidePaperOrder, readPaperDecision } from "../services/paper-decisions.mjs";
import { PAPER_DECISION_LIMITATIONS } from "../services/paper-decisions.mjs";
import * as decisions from "../services/paper-decisions.mjs";
import { createPaperOrderStore } from "../services/paper-orders.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Lag threshold 1000 and fee rate 0.001 are caller fixtures.
// The source names no max event lag and no fee tier.
// Bids and asks are the decision 0034 book. Notional 1 is a fixture.
const TIME = 1499865549590;
const LAG = 1000;
const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

function features() {
  const row = {};
  for (const name of BASELINE_FEATURES) row[name] = "1";
  return row;
}

function quality(extra = {}) {
  return {
    asOf: TIME,
    receiveTime: TIME,
    lagThreshold: LAG,
    features: [{
      name: "spread",
      source: "fixture-source",
      eventTime: TIME,
      window: { from: TIME, to: TIME },
      quality: { healthy: true, reason: null },
    }],
    ...extra,
  };
}

function fees(extra = {}) {
  return {
    bids: BIDS,
    asks: ASKS,
    quantity: "3",
    feeRate: "0.001",
    ...extra,
  };
}

function request(extra = {}) {
  return {
    actor: { ...ACTOR },
    decisionId: "fixture-decision",
    idempotencyKey: "fixture-key",
    orderId: "fixture-order",
    featureVersion: "fixture-features",
    prediction: { version: "fixture-baseline", features: features() },
    quality: quality(),
    limits: { maxNotional: "1" },
    notional: "1",
    fees: fees(),
    killSwitch: false,
    ...extra,
  };
}

function bound() {
  const baseline = createBaselineStore();
  const registered = registerBaselineModel(baseline, { version: "fixture-baseline" });
  assert.equal(registered.ok, true, registered.error);
  const orders = createPaperOrderStore();
  const decisions = createPaperDecisionStore();
  return { baseline, orders, decisions };
}

test("an approved spot prediction creates one auditable paper order", () => {
  const stores = bound();
  const input = request();
  const decided = decidePaperOrder(stores, input);
  assert.equal(decided.ok, true, decided.error);
  assert.equal(decided.orderCreated, true);
  assert.equal(decided.idempotentReplay, false);
  assert.equal(decided.audit.dataApproved, true);
  assert.equal(decided.audit.riskApproved, true);
  assert.equal(decided.audit.modelVersion, "fixture-baseline");
  assert.equal(decided.audit.formula, BASELINE_FORMULA);
  assert.equal(decided.audit.featureVersion, "fixture-features");
  assert.equal(decided.audit.score, "100");
  assert.equal(decided.audit.calibratedProbability, null);
  assert.equal(decided.audit.killSwitch, false);
  assert.equal(decided.audit.notional, "1");
  assert.equal(decided.audit.maxNotional, "1");
  assert.equal(decided.audit.orderId, "fixture-order");
  assert.equal(decided.audit.liveTrading, "OFF");
  assert.equal(decided.audit.liveOrdersLocked, true);
  assert.equal(decided.audit.liveOrderSubmitted, false);
  assert.equal(decided.audit.venueClient, null);
  assert.equal(decided.audit.mode, "paper");
  assert.equal(decided.audit.product, "spot");
  assert.deepEqual(decided.audit.limitations, [...PAPER_DECISION_LIMITATIONS]);
  const cost = readExecutionCost(fees());
  assert.equal(cost.ok, true, cost.error);
  assert.equal(decided.audit.netReturn, cost.netReturn);
  assert.equal(decided.audit.netReturn, "-1051/25500");
  assert.equal(decided.audit.feeFormula, "round-trip fee plus spread and depth slippage");
  assert.equal(stores.orders.orders.size, 1);
  const paper = stores.orders.orders.get("fixture-tenant\u0000fixture-order");
  assert.equal(paper.events.length, 1);
  assert.equal(paper.events[0].state, "create");
  assert.equal(paper.events[0].venueClient, null);
  assert.equal(paper.events[0].liveOrderSubmitted, false);
  input.notional = "9";
  assert.equal(decided.audit.notional, "1");
  assert.equal(Object.isFrozen(decided.audit), true);
  assert.throws(() => {
    decided.audit.orderCreated = false;
  }, TypeError);
  const replay = decidePaperOrder(stores, request());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.audit, decided.audit);
  assert.equal(stores.orders.orders.size, 1);
  assert.equal(stores.decisions.audits.length, 1);
  const read = readPaperDecision(stores.decisions, { actor: { ...ACTOR }, decisionId: "fixture-decision" });
  assert.equal(read.audit, decided.audit);
  assert.equal(read.orderCreated, true);
});

test("a prediction without data or risk approval creates no order", () => {
  const stores = bound();
  const leaked = decidePaperOrder(stores, request({
    decisionId: "fixture-leak",
    idempotencyKey: "fixture-key-leak",
    orderId: "fixture-leak-order",
    quality: quality({
      receiveTime: TIME + 1,
      features: [{
        name: "spread",
        source: "fixture-source",
        eventTime: TIME + 1,
        window: { from: TIME + 1, to: TIME + 1 },
        quality: { healthy: true, reason: null },
      }],
    }),
  }));
  assert.equal(leaked.orderCreated, false);
  assert.equal(leaked.blocked, "BLOCKED");
  assert.equal(leaked.error, "lookahead window");
  assert.equal(leaked.audit.dataApproved, false);
  assert.equal(leaked.audit.riskApproved, true);
  assert.equal(leaked.audit.qualityFeature, "spread");
  assert.equal(leaked.audit.qualitySource, "fixture-source");
  assert.equal(leaked.audit.score, "100");
  assert.equal(stores.orders.orders.size, 0);
  const prior = stores.decisions.audits;

  const killed = decidePaperOrder(stores, request({
    decisionId: "fixture-kill",
    idempotencyKey: "fixture-key-kill",
    orderId: "fixture-kill-order",
    killSwitch: true,
  }));
  assert.equal(killed.orderCreated, false);
  assert.equal(killed.error, "kill switch is on");
  assert.equal(killed.audit.dataApproved, true);
  assert.equal(killed.audit.riskApproved, false);
  assert.equal(killed.audit.killSwitch, true);
  assert.equal(stores.orders.orders.size, 0);

  const over = decidePaperOrder(stores, request({
    decisionId: "fixture-notional",
    idempotencyKey: "fixture-key-notional",
    orderId: "fixture-notional-order",
    notional: "1.1",
  }));
  assert.equal(over.orderCreated, false);
  assert.equal(over.error, "notional cap is exceeded");
  assert.equal(over.audit.riskApproved, false);
  assert.equal(over.audit.dataApproved, true);
  assert.equal(stores.orders.orders.size, 0);

  const short = decidePaperOrder(stores, request({
    decisionId: "fixture-depth",
    idempotencyKey: "fixture-key-depth",
    orderId: "fixture-depth-order",
    fees: fees({ quantity: "5" }),
  }));
  assert.equal(short.orderCreated, false);
  assert.equal(short.error, "depth is not sufficient");
  assert.equal(short.audit.netReturn, null);
  assert.equal(short.audit.riskApproved, false);
  assert.equal(stores.orders.orders.size, 0);
  assert.equal(prior.length, 1);
  assert.equal(prior[0], leaked.audit);
  assert.equal(stores.decisions.audits.length, 4);
  assert.equal(Object.isFrozen(prior), true);

  const missingModel = decidePaperOrder(stores, request({
    decisionId: "fixture-model",
    idempotencyKey: "fixture-key-model",
    orderId: "fixture-model-order",
    prediction: { version: "fixture-missing", features: features() },
  }));
  assert.equal(missingModel.orderCreated, false);
  assert.equal(missingModel.error, "model version is not configured");
  assert.equal(missingModel.audit.score, null);
  assert.equal(missingModel.audit.dataApproved, false);
  assert.equal(stores.orders.orders.size, 0);

  const customer = decidePaperOrder(stores, request({
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
  }));
  assert.equal(customer.error, "role scope denied");
  assert.equal(customer.audit, null);
  assert.equal(customer.orderCreated, false);

  const secret = decidePaperOrder(stores, request({ idempotencyKey: "bearer fixture-token" }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(secret.audit, null);
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);

  const scored = decidePaperOrder(stores, request({
    decisionId: "fixture-score",
    idempotencyKey: "fixture-key-score",
    quality: quality({ score: "91" }),
  }));
  assert.equal(scored.error, "unsupported field");
  assert.equal(scored.audit, null);
  assert.equal(JSON.stringify(scored).includes("91"), false);

  const changed = decidePaperOrder(stores, request({
    decisionId: "fixture-leak",
    idempotencyKey: "fixture-key-leak",
    orderId: "fixture-leak-order",
    notional: "0",
    quality: quality({
      receiveTime: TIME + 1,
      features: [{
        name: "spread",
        source: "fixture-source",
        eventTime: TIME + 1,
        window: { from: TIME + 1, to: TIME + 1 },
        quality: { healthy: true, reason: null },
      }],
    }),
  }));
  assert.equal(changed.error, "decision is already recorded");
  assert.equal(stores.orders.orders.size, 0);
  const otherTenant = readPaperDecision(stores.decisions, {
    actor: { id: "fixture-admin", role: "Admin", tenantId: "fixture-other" },
    decisionId: "fixture-leak",
  });
  assert.equal(otherTenant.error, "decision is not configured");
  assert.equal(otherTenant.audit, null);
});

test("the paper gate does not submit a live order", () => {
  assert.deepEqual(Object.keys(decisions).sort(), [
    "PAPER_DECISION_LIMITATIONS",
    "createPaperDecisionStore",
    "decidePaperOrder",
    "readPaperDecision",
  ]);
  const source = readFileSync(new URL("../services/paper-decisions.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("scoreBaselineModel"), true);
  assert.equal(source.includes("checkFeatureQuality"), true);
  assert.equal(source.includes("readExecutionCost"), true);
  assert.equal(source.includes("appendPaperOrder"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.equal(source.includes("readFuturesRisk"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
