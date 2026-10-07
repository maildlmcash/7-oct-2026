import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  BASELINE_FEATURES,
  createBaselineStore,
  registerBaselineModel,
} from "../services/baseline-model.mjs";
import { createPaperDecisionStore } from "../services/paper-decisions.mjs";
import {
  PAPER_FAULT_LIMITATIONS,
  PAPER_FAULTS,
  injectPaperFault,
} from "../services/paper-faults.mjs";
import * as faults from "../services/paper-faults.mjs";
import { appendPaperOrder, createPaperOrderStore } from "../services/paper-orders.mjs";

// Lag 1000, fee 0.001, notional 1, and clock 60000 are caller fixtures.
// The source names no timeout duration and no balance formula.
const TIME = 1499865549590;
const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];

function features() {
  const row = {};
  for (const name of BASELINE_FEATURES) row[name] = "1";
  return row;
}

function stores() {
  const baseline = createBaselineStore();
  const registered = registerBaselineModel(baseline, { version: "fixture-baseline" });
  assert.equal(registered.ok, true, registered.error);
  return {
    baseline,
    orders: createPaperOrderStore(),
    decisions: createPaperDecisionStore(),
  };
}

function step(orderId, key, state) {
  return {
    actor: { ...ACTOR },
    orderId,
    idempotencyKey: key,
    state,
    product: "spot",
  };
}

function decision(extra = {}) {
  return {
    actor: { ...ACTOR },
    decisionId: "fixture-kill",
    idempotencyKey: "fixture-key-kill",
    orderId: "fixture-kill-order",
    featureVersion: "fixture-features",
    prediction: { version: "fixture-baseline", features: features() },
    quality: {
      asOf: TIME,
      receiveTime: TIME,
      lagThreshold: 1000,
      features: [{
        name: "spread",
        source: "fixture-source",
        eventTime: TIME,
        window: { from: TIME, to: TIME },
        quality: { healthy: true, reason: null },
      }],
    },
    limits: { maxNotional: "1" },
    notional: "1",
    fees: { bids: BIDS, asks: ASKS, quantity: "3", feeRate: "0.001" },
    killSwitch: true,
    ...extra,
  };
}

function paper(result) {
  assert.equal(result.duplicateOrder, false);
  assert.equal(result.position, null);
  assert.equal(result.killSwitchClosed, false);
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.equal(result.product, "spot");
  assert.deepEqual(result.limitations, [...PAPER_FAULT_LIMITATIONS]);
}

test("duplicate, timeout, race, and restart do not create a second order", () => {
  const duplicateStore = stores();
  const duplicated = injectPaperFault(duplicateStore, {
    fault: "duplicate submission",
    submission: step("fixture-order", "fixture-key", "create"),
  });
  paper(duplicated);
  assert.equal(duplicated.ok, true, duplicated.error);
  assert.equal(duplicated.orderCreated, true);
  assert.equal(duplicated.idempotentReplay, true);
  assert.equal(duplicated.orderCount, 1);
  assert.equal(duplicated.eventCount, 1);
  assert.deepEqual(duplicated.states, ["create"]);
  const again = injectPaperFault(duplicateStore, {
    fault: "duplicate submission",
    submission: step("fixture-order", "fixture-key", "create"),
  });
  paper(again);
  assert.equal(again.orderCreated, false);
  assert.equal(again.orderCount, 1);
  assert.equal(again.eventCount, 1);
  assert.equal(duplicateStore.orders.orders.size, 1);

  const timeoutStore = stores();
  const timed = injectPaperFault(timeoutStore, {
    fault: "timeout",
    prepare: [
      step("fixture-order", "fixture-key-create", "create"),
      step("fixture-order", "fixture-key-ack", "acknowledge"),
    ],
    clock: 60000,
  });
  paper(timed);
  assert.equal(timed.ok, true, timed.error);
  assert.equal(timed.timeoutApplied, false);
  assert.equal(timed.closed, false);
  assert.deepEqual(timed.states, ["create", "acknowledge"]);
  assert.equal(timed.orderCount, 1);
  assert.equal(timed.eventCount, 2);
  assert.equal(timed.closeRule, "a clock does not append timeout because the duration is NOT IN SOURCE");

  const cancelFirst = stores();
  const cancelled = injectPaperFault(cancelFirst, {
    fault: "cancel/fill race",
    prepare: [
      step("fixture-order", "fixture-key-create", "create"),
      step("fixture-order", "fixture-key-ack", "acknowledge"),
    ],
    first: step("fixture-order", "fixture-key-cancel", "cancel"),
    second: step("fixture-order", "fixture-key-fill", "fill"),
  });
  paper(cancelled);
  assert.equal(cancelled.ok, true, cancelled.error);
  assert.equal(cancelled.closed, true);
  assert.equal(cancelled.orderCount, 1);
  assert.equal(cancelled.rejectedError, "transition is not allowed");
  assert.deepEqual(cancelled.states, ["create", "acknowledge", "cancel"]);
  assert.equal(cancelled.states.includes("fill"), false);

  const fillFirst = stores();
  const filled = injectPaperFault(fillFirst, {
    fault: "cancel/fill race",
    prepare: [
      step("fixture-order", "fixture-key-create", "create"),
      step("fixture-order", "fixture-key-ack", "acknowledge"),
    ],
    first: step("fixture-order", "fixture-key-fill", "fill"),
    second: step("fixture-order", "fixture-key-cancel", "cancel"),
  });
  paper(filled);
  assert.equal(filled.ok, true, filled.error);
  assert.equal(filled.closed, false);
  assert.equal(filled.orderCount, 1);
  assert.equal(filled.rejectedError, "transition is not allowed");
  assert.deepEqual(filled.states, ["create", "acknowledge", "fill"]);
  assert.equal(filled.states.includes("cancel"), false);

  const restartStore = stores();
  const replay = [
    step("fixture-order", "fixture-key-create", "create"),
    step("fixture-order", "fixture-key-ack", "acknowledge"),
  ];
  const restarted = injectPaperFault(restartStore, { fault: "restart", replay });
  paper(restarted);
  assert.equal(restarted.ok, true, restarted.error);
  assert.equal(restarted.restored, false);
  assert.equal(restarted.callerOrderCount, 0);
  assert.equal(restarted.orderCount, 1);
  assert.equal(restarted.eventCount, 2);
  assert.equal(restarted.idempotentReplay, true);
  assert.deepEqual(restarted.states, ["create", "acknowledge"]);
  assert.equal(restartStore.orders.orders.size, 0);
  assert.equal(Object.isFrozen(restarted), true);
});

test("a stale balance and a kill switch do not open or close an order", () => {
  const staleStore = stores();
  const stale = injectPaperFault(staleStore, {
    fault: "stale balance",
    balance: "fixture-balance",
    stale: true,
  });
  paper(stale);
  assert.equal(stale.ok, false);
  assert.equal(stale.blocked, "BLOCKED");
  assert.equal(stale.error, "balance reconciliation is NOT IN SOURCE");
  assert.equal(stale.orderCreated, false);
  assert.equal(stale.closed, false);
  assert.equal(stale.orderCount, 0);
  assert.equal(JSON.stringify(stale).includes("fixture-balance"), false);
  const secret = injectPaperFault(staleStore, {
    fault: "stale balance",
    balance: "bearer fixture-token",
    stale: true,
  });
  paper(secret);
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(staleStore.orders.orders.size, 0);

  const killedStore = stores();
  const created = appendPaperOrder(killedStore.orders, step("fixture-order", "fixture-key-create", "create"));
  const acknowledged = appendPaperOrder(killedStore.orders, step("fixture-order", "fixture-key-ack", "acknowledge"));
  assert.equal(created.ok, true, created.error);
  assert.equal(acknowledged.ok, true, acknowledged.error);
  const killed = injectPaperFault(killedStore, {
    fault: "kill switch",
    decision: decision(),
  });
  paper(killed);
  assert.equal(killed.ok, true, killed.error);
  assert.equal(killed.decisionError, "kill switch is on");
  assert.equal(killed.orderCreated, false);
  assert.equal(killed.closed, false);
  assert.equal(killed.killSwitchClosed, false);
  assert.equal(killed.idempotentReplay, true);
  assert.equal(killed.orderCount, 1);
  assert.equal(killed.eventCount, 2);
  assert.deepEqual(killed.states, ["create", "acknowledge"]);
  assert.equal(killed.closeRule, "kill switch blocks a new paper decision and does not cancel, fill, or reconcile");
  assert.equal(killedStore.orders.orders.size, 1);
  assert.equal(killedStore.decisions.audits.length, 1);
  assert.equal(killedStore.decisions.audits[0].orderCreated, false);
  const off = injectPaperFault(killedStore, {
    fault: "kill switch",
    decision: decision({ killSwitch: false }),
  });
  paper(off);
  assert.equal(off.error, "kill switch is not on");
  assert.equal(off.orderCreated, false);
  assert.equal(killedStore.orders.orders.size, 1);
  assert.equal(killedStore.decisions.audits.length, 1);
});

test("the paper fault injection does not submit a live order", () => {
  assert.deepEqual(PAPER_FAULTS, [
    "duplicate submission",
    "timeout",
    "cancel/fill race",
    "restart",
    "stale balance",
    "kill switch",
  ]);
  assert.deepEqual(Object.keys(faults).sort(), [
    "PAPER_FAULTS",
    "PAPER_FAULT_LIMITATIONS",
    "injectPaperFault",
  ]);
  const source = readFileSync(new URL("../services/paper-faults.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("appendPaperOrder"), true);
  assert.equal(source.includes("decidePaperOrder"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
