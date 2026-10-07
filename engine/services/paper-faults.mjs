// Paper fault injection for TASK 14.C.01.
// Duplicate submission replays the stored paper event.
// A clock does not append timeout: the duration is NOT IN SOURCE.
// A cancel/fill race keeps the first accepted state and appends nothing for the other.
// A restart does not restore the in-memory log and a second replay does not duplicate it.
// A stale balance does not create an order or a position. Balance reconciliation
// and position are NOT IN SOURCE.
// The kill switch blocks a new paper decision. Decision 0065 does not cancel,
// fill, or reconcile an existing paper order, so this injection does not either.
// This module does not open a venue client.

import { decidePaperOrder } from "./paper-decisions.mjs";
import { appendPaperOrder, createPaperOrderStore } from "./paper-orders.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const FAULT_KEYS = Object.freeze({
  "duplicate submission": Object.freeze(["fault", "submission"]),
  timeout: Object.freeze(["fault", "prepare", "clock"]),
  "cancel/fill race": Object.freeze(["fault", "prepare", "first", "second"]),
  restart: Object.freeze(["fault", "replay"]),
  "stale balance": Object.freeze(["fault", "balance", "stale"]),
  "kill switch": Object.freeze(["fault", "decision"]),
});

export const PAPER_FAULTS = Object.freeze(Object.keys(FAULT_KEYS));
export const PAPER_FAULT_LIMITATIONS = Object.freeze([
  "timeout duration is NOT IN SOURCE",
  "balance reconciliation is NOT IN SOURCE",
  "position is NOT IN SOURCE",
  "kill switch does not cancel, fill, or reconcile",
  "paper log is not durable",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    fault: null,
    duplicateOrder: false,
    position: null,
    orderCreated: false,
    closed: false,
    killSwitchClosed: false,
    closeRule: null,
    timeoutApplied: false,
    restored: false,
    idempotentReplay: false,
    orderCount: null,
    eventCount: null,
    callerOrderCount: null,
    states: null,
    rejectedError: null,
    decisionError: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_FAULT_LIMITATIONS,
  });
}

function report(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    fault: fields.fault,
    duplicateOrder: false,
    position: null,
    orderCreated: fields.orderCreated === true,
    closed: fields.closed === true,
    killSwitchClosed: false,
    closeRule: fields.closeRule,
    timeoutApplied: false,
    restored: false,
    idempotentReplay: fields.idempotentReplay === true,
    orderCount: fields.orderCount,
    eventCount: fields.eventCount,
    callerOrderCount: fields.callerOrderCount ?? null,
    states: fields.states,
    rejectedError: fields.rejectedError ?? null,
    decisionError: fields.decisionError ?? null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_FAULT_LIMITATIONS,
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function leaked(value) {
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function orderStore(stores) {
  return plainObject(stores)
    && plainObject(stores.orders)
    && stores.orders.orders instanceof Map
    && stores.orders.keys instanceof Map;
}

function counts(store) {
  let events = 0;
  const ids = new Set();
  let duplicate = false;
  for (const order of store.orders.values()) {
    events += order.events.length;
    if (ids.has(order.orderId)) duplicate = true;
    ids.add(order.orderId);
  }
  return { orders: store.orders.size, events, duplicate };
}

function statesOf(store) {
  const states = [];
  for (const order of store.orders.values()) {
    for (const event of order.events) states.push(event.state);
  }
  return states;
}

function sameStates(before, store) {
  const after = statesOf(store);
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) return false;
  }
  return true;
}

function applyAll(store, steps) {
  const applied = [];
  for (const step of steps) {
    const result = appendPaperOrder(store, step);
    if (!result.ok) return result;
    applied.push(result);
  }
  return { ok: true, applied };
}

function duplicate(store, input) {
  if (!plainObject(input.submission)) return fail("unsupported field");
  const before = counts(store);
  const first = appendPaperOrder(store, input.submission);
  if (!first.ok) return fail(first.error);
  const mid = counts(store);
  const second = appendPaperOrder(store, input.submission);
  const after = counts(store);
  if (!second.ok || second.idempotentReplay !== true || after.orders !== mid.orders || after.events !== mid.events || after.duplicate) {
    return fail(second.error || "duplicate order");
  }
  return report({
    ok: true,
    fault: "duplicate submission",
    orderCreated: mid.orders > before.orders,
    closeRule: "the same submission replays the stored event and does not append another order",
    idempotentReplay: true,
    orderCount: after.orders,
    eventCount: after.events,
    states: Object.freeze(statesOf(store)),
  });
}

function timeout(store, input) {
  if (!Array.isArray(input.prepare)) return fail("unsupported field");
  if (input.clock === undefined || input.clock === null || input.clock === "") {
    return fail("clock is not configured");
  }
  if (!whole(input.clock)) return fail("unsupported field");
  const applied = applyAll(store, input.prepare);
  if (!applied.ok) return fail(applied.error);
  const tally = counts(store);
  const states = statesOf(store);
  if (tally.duplicate || states.includes("timeout")) return fail("timeout was appended");
  return report({
    ok: true,
    fault: "timeout",
    orderCreated: tally.orders > 0,
    closeRule: "a clock does not append timeout because the duration is NOT IN SOURCE",
    orderCount: tally.orders,
    eventCount: tally.events,
    states: Object.freeze(states),
  });
}

function race(store, input) {
  if (!Array.isArray(input.prepare) || !plainObject(input.first) || !plainObject(input.second)) {
    return fail("unsupported field");
  }
  const pair = [input.first.state, input.second.state];
  if (!pair.includes("cancel") || !pair.includes("fill") || input.first.state === input.second.state) {
    return fail("unsupported field");
  }
  const prepared = applyAll(store, input.prepare);
  if (!prepared.ok) return fail(prepared.error);
  const won = appendPaperOrder(store, input.first);
  if (!won.ok) return fail(won.error);
  const lost = appendPaperOrder(store, input.second);
  const tally = counts(store);
  const states = statesOf(store);
  const both = states.includes("cancel") && states.includes("fill");
  if (lost.ok || both || tally.duplicate || tally.orders !== 1) return fail("race appended both states");
  return report({
    ok: true,
    fault: "cancel/fill race",
    closed: won.order.state === "cancel",
    closeRule: "the first accepted paper state stands and the other appends nothing",
    orderCount: tally.orders,
    eventCount: tally.events,
    states: Object.freeze(states),
    rejectedError: lost.error,
  });
}

function restart(stores, input) {
  if (!Array.isArray(input.replay)) return fail("unsupported field");
  const before = counts(stores.orders);
  const fresh = createPaperOrderStore();
  const first = applyAll(fresh, input.replay);
  if (!first.ok) return fail(first.error);
  const mid = counts(fresh);
  const second = applyAll(fresh, input.replay);
  const after = counts(fresh);
  const caller = counts(stores.orders);
  const replayed = second.ok && second.applied.every((item) => item.idempotentReplay === true);
  if (!replayed || after.orders !== mid.orders || after.events !== mid.events || after.duplicate || caller.orders !== before.orders || caller.events !== before.events) {
    return fail(second.error || "duplicate order");
  }
  return report({
    ok: true,
    fault: "restart",
    closeRule: "a restart does not restore the paper log",
    idempotentReplay: true,
    orderCount: after.orders,
    eventCount: after.events,
    callerOrderCount: caller.orders,
    states: Object.freeze(statesOf(fresh)),
  });
}

function stale(store, input) {
  if (input.stale !== true) return fail("unsupported field");
  if (input.balance === undefined || input.balance === null || (typeof input.balance === "string" && input.balance.trim() === "")) {
    return fail("balance is not configured");
  }
  if (typeof input.balance !== "string" || leaked(input.balance)) {
    return fail(leaked(input.balance) ? "secret value is not allowed" : "unsupported field");
  }
  const tally = counts(store);
  if (tally.duplicate) return fail("duplicate order");
  return report({
    ok: false,
    error: "balance reconciliation is NOT IN SOURCE",
    fault: "stale balance",
    closeRule: "a stale balance does not create an order or a position",
    orderCount: tally.orders,
    eventCount: tally.events,
    states: Object.freeze(statesOf(store)),
  });
}

function kill(stores, input) {
  if (!plainObject(input.decision) || input.decision.killSwitch !== true) return fail("kill switch is not on");
  if (!plainObject(stores.decisions) || !Array.isArray(stores.decisions.audits) || !plainObject(stores.baseline)) {
    return fail("unsupported field");
  }
  const before = counts(stores.orders);
  const beforeStates = statesOf(stores.orders);
  const beforeAudits = stores.decisions.audits.length;
  const decided = decidePaperOrder(stores, input.decision);
  const replay = decidePaperOrder(stores, input.decision);
  const after = counts(stores.orders);
  const unchanged = sameStates(beforeStates, stores.orders)
    && after.orders === before.orders
    && after.events === before.events
    && !after.duplicate;
  if (decided.orderCreated === true || replay.orderCreated === true || !unchanged) {
    return fail("kill switch created an order");
  }
  const prevented = decided.error === "kill switch is on" && decided.orderCreated === false;
  const oneAudit = stores.decisions.audits.length === beforeAudits + 1 && replay.idempotentReplay === true;
  if (!prevented || !oneAudit) return fail(decided.error || "kill switch is not on");
  return report({
    ok: true,
    fault: "kill switch",
    closeRule: "kill switch blocks a new paper decision and does not cancel, fill, or reconcile",
    idempotentReplay: true,
    decisionError: decided.error,
    orderCount: after.orders,
    eventCount: after.events,
    states: Object.freeze(statesOf(stores.orders)),
  });
}

export function injectPaperFault(stores, input) {
  if (!orderStore(stores)) return fail("unsupported field");
  if (!plainObject(input) || !Object.hasOwn(FAULT_KEYS, input.fault)) return fail("unsupported field");
  if (unknownKey(input, FAULT_KEYS[input.fault])) return fail("unsupported field");
  if (input.fault === "duplicate submission") return duplicate(stores.orders, input);
  if (input.fault === "timeout") return timeout(stores.orders, input);
  if (input.fault === "cancel/fill race") return race(stores.orders, input);
  if (input.fault === "restart") return restart(stores, input);
  if (input.fault === "stale balance") return stale(stores.orders, input);
  return kill(stores, input);
}
