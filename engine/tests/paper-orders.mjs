import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  PAPER_ORDER_LIMITATIONS,
  PAPER_ORDER_MODE,
  PAPER_ORDER_PRODUCT,
  PAPER_ORDER_STATES,
  appendPaperOrder,
  createPaperOrderStore,
  readPaperOrder,
} from "../services/paper-orders.mjs";
import * as orders from "../services/paper-orders.mjs";

const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };

function request(orderId, idempotencyKey, state, extra = {}) {
  return {
    actor: { ...ACTOR },
    orderId,
    idempotencyKey,
    state,
    product: PAPER_ORDER_PRODUCT,
    ...extra,
  };
}

function walk(store, orderId, states) {
  const results = [];
  for (const state of states) {
    const appended = appendPaperOrder(store, request(orderId, `${orderId}:${state}:${results.length}`, state));
    assert.equal(appended.ok, true, appended.error);
    results.push(appended);
  }
  return results;
}

test("paper states append in order and a duplicate request replays", () => {
  const store = createPaperOrderStore();
  const created = appendPaperOrder(store, request("fixture-order", "fixture-key-create", "create"));
  assert.equal(created.ok, true, created.error);
  assert.equal(created.idempotentReplay, false);
  assert.equal(created.order.mode, PAPER_ORDER_MODE);
  assert.equal(created.order.product, "spot");
  assert.equal(created.order.liveTrading, "OFF");
  assert.equal(created.order.liveOrdersLocked, true);
  assert.equal(created.order.liveOrderSubmitted, false);
  assert.equal(created.order.venueClient, null);
  assert.deepEqual(created.order.limitations, [...PAPER_ORDER_LIMITATIONS]);
  assert.equal(created.event.sequence, "1");
  assert.equal(created.event.state, "create");
  const firstEvents = created.order.events;

  const acknowledged = appendPaperOrder(store, request("fixture-order", "fixture-key-ack", "acknowledge"));
  const partial = appendPaperOrder(store, request("fixture-order", "fixture-key-partial-1", "partial fill"));
  const partialAgain = appendPaperOrder(store, request("fixture-order", "fixture-key-partial-2", "partial fill"));
  const filled = appendPaperOrder(store, request("fixture-order", "fixture-key-fill", "fill"));
  const reconciled = appendPaperOrder(store, request("fixture-order", "fixture-key-reconcile", "reconcile"));
  assert.equal(reconciled.ok, true, reconciled.error);
  assert.equal(reconciled.order.state, "reconcile");
  assert.deepEqual(reconciled.order.events.map((event) => event.state), [
    "create",
    "acknowledge",
    "partial fill",
    "partial fill",
    "fill",
    "reconcile",
  ]);
  assert.deepEqual(reconciled.order.events.map((event) => event.sequence), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(firstEvents.length, 1);
  assert.equal(firstEvents[0].state, "create");
  assert.equal(Object.isFrozen(firstEvents), true);
  assert.equal(Object.isFrozen(reconciled.order.events), true);
  assert.equal(Object.isFrozen(reconciled.event), true);
  assert.throws(() => {
    reconciled.order.events.push(reconciled.event);
  }, TypeError);
  assert.throws(() => {
    reconciled.event.state = "fill";
  }, TypeError);
  assert.equal(reconciled.order.events[0], created.event);
  assert.equal(acknowledged.order.venueClient, null);
  assert.equal(partial.order.liveOrderSubmitted, false);
  assert.equal(partialAgain.order.liveOrderSubmitted, false);
  assert.equal(filled.order.venueClient, null);

  const replay = appendPaperOrder(store, request("fixture-order", "fixture-key-create", "create"));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.event, created.event);
  assert.equal(replay.order.events.length, 6);
  const read = readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-order" });
  assert.deepEqual(read.order, replay.order);
  assert.equal(store.orders.size, 1);

  const rejected = walk(store, "fixture-reject", ["create", "reject", "reconcile"]);
  assert.equal(rejected[2].order.state, "reconcile");
  const timedOut = walk(store, "fixture-timeout", ["create", "timeout", "reconcile"]);
  assert.equal(timedOut[1].event.state, "timeout");
  const cancelled = walk(store, "fixture-cancel", ["create", "acknowledge", "cancel", "reconcile"]);
  assert.deepEqual(cancelled.map((item) => item.event.state), ["create", "acknowledge", "cancel", "reconcile"]);
  const covered = [
    ...reconciled.order.events,
    ...rejected[2].order.events,
    ...timedOut[2].order.events,
    ...cancelled[3].order.events,
  ].map((event) => event.state);
  for (const state of PAPER_ORDER_STATES) {
    assert.equal(covered.includes(state), true, state);
  }
});

test("an illegal transition and a duplicate body stay unchanged", () => {
  const store = createPaperOrderStore();
  const early = appendPaperOrder(store, request("fixture-order", "fixture-key-fill", "fill"));
  assert.equal(early.error, "transition is not allowed");
  assert.equal(early.order, null);
  assert.equal(store.orders.size, 0);

  const created = appendPaperOrder(store, request("fixture-order", "fixture-key-create", "create"));
  assert.equal(created.ok, true, created.error);
  const filledEarly = appendPaperOrder(store, request("fixture-order", "fixture-key-fill-2", "fill"));
  assert.equal(filledEarly.error, "transition is not allowed");
  assert.equal(readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-order" }).order.state, "create");
  assert.equal(readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-order" }).order.events.length, 1);

  appendPaperOrder(store, request("fixture-order", "fixture-key-ack", "acknowledge"));
  const rejectedLate = appendPaperOrder(store, request("fixture-order", "fixture-key-reject", "reject"));
  assert.equal(rejectedLate.error, "transition is not allowed");
  const filled = appendPaperOrder(store, request("fixture-order", "fixture-key-fill-3", "fill"));
  assert.equal(filled.ok, true, filled.error);
  const cancelledLate = appendPaperOrder(store, request("fixture-order", "fixture-key-cancel", "cancel"));
  assert.equal(cancelledLate.error, "transition is not allowed");
  assert.equal(readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-order" }).order.state, "fill");

  const changed = appendPaperOrder(store, request("fixture-order", "fixture-key-create", "acknowledge"));
  assert.equal(changed.error, "idempotency key is already recorded");
  assert.equal(readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-order" }).order.events.length, 3);
  const secondCreate = appendPaperOrder(store, request("fixture-order", "fixture-key-create-2", "create"));
  assert.equal(secondCreate.error, "order is already recorded");

  const otherProduct = appendPaperOrder(store, request("fixture-futures-order", "fixture-key-futures", "create", {
    product: "futures",
  }));
  assert.equal(otherProduct.error, "product is not supported");
  assert.equal(otherProduct.order, null);
  assert.equal(JSON.stringify(otherProduct).includes("fixture-futures-order"), false);
  assert.equal(readPaperOrder(store, { actor: { ...ACTOR }, orderId: "fixture-futures-order" }).error, "order is not configured");

  const customer = appendPaperOrder(store, request("fixture-order", "fixture-key-customer", "cancel", {
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
  }));
  assert.equal(customer.error, "role scope denied");
  assert.equal(customer.order, null);

  const secret = appendPaperOrder(store, request("fixture-order", "bearer fixture-token", "reconcile"));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);

  const live = appendPaperOrder(store, request("fixture-live-order", "fixture-key-live", "live-order"));
  assert.equal(live.error, "unsupported field");
  assert.equal(live.order, null);
  assert.equal(JSON.stringify(live).includes("live-order"), false);
  assert.equal(store.orders.size, 1);

  const otherTenant = readPaperOrder(store, {
    actor: { id: "fixture-admin", role: "Admin", tenantId: "fixture-other" },
    orderId: "fixture-order",
  });
  assert.equal(otherTenant.error, "order is not configured");
  assert.equal(otherTenant.order, null);
});

test("paper mode does not reach a live venue client", () => {
  assert.deepEqual(Object.keys(orders).sort(), [
    "PAPER_ORDER_LIMITATIONS",
    "PAPER_ORDER_MODE",
    "PAPER_ORDER_PRODUCT",
    "PAPER_ORDER_STATES",
    "appendPaperOrder",
    "createPaperOrderStore",
    "readPaperOrder",
  ]);
  assert.deepEqual([...PAPER_ORDER_STATES], [
    "create",
    "acknowledge",
    "partial fill",
    "fill",
    "cancel",
    "reject",
    "timeout",
    "reconcile",
  ]);
  const source = readFileSync(new URL("../services/paper-orders.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("import "), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("readExecutionCost"), false);
  assert.equal(source.includes("Math.random"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  const store = createPaperOrderStore();
  const created = appendPaperOrder(store, request("fixture-order", "fixture-key-create", "create"));
  assert.equal(created.order.liveTrading, health.liveTrading);
  assert.equal(created.order.liveOrdersLocked, health.liveOrdersLocked);
  assert.equal(created.order.venueClient, null);
});
