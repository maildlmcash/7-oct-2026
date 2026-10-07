// Futures failure drills for TASK 15.C.01.
// Missing mark price, funding outage, stream gap, worker restart, and order
// timeout each raise an alert and disable new simulated risk. New risk stays
// disabled until the caller reconciles the feed and the paper position.
// A clock does not decide timeout: the duration is NOT IN SOURCE. A timeout
// is unknown pending reconciliation and is not retried. A restart does not
// restore worker memory and does not delete the paper position. This module
// does not open a venue client.

import { evaluateFuturesFaults } from "./futures-faults.mjs";
import { appendFuturesPaperOrder, readFuturesPaperPosition } from "./futures-paper.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const READ_KEYS = Object.freeze(["actor", "drillId"]);
const RECONCILE_KEYS = Object.freeze(["actor", "drillId", "data", "state"]);
const STATE_KEYS = Object.freeze(["positionQuantity"]);
const ATTEMPT_KEYS = Object.freeze(["actor", "drillId", "idempotencyKey", "orderId", "order"]);
const ORDER_KEYS = Object.freeze([
  "contractId",
  "direction",
  "quantity",
  "price",
  "reduceOnly",
  "positionMode",
  "marginMode",
  "product",
]);
const STORE_KEYS = Object.freeze(["contracts", "futures", "drills"]);
const REDUCE_WHILE_LATCHED = new Set(["missing mark price", "stream gap"]);

const SCENARIO_KEYS = Object.freeze({
  "missing mark price": Object.freeze(["actor", "drillId", "idempotencyKey", "scenario", "contractId", "feed"]),
  "funding outage": Object.freeze(["actor", "drillId", "idempotencyKey", "scenario", "contractId", "feed"]),
  "stream gap": Object.freeze(["actor", "drillId", "idempotencyKey", "scenario", "contractId", "feed"]),
  "worker restart": Object.freeze(["actor", "drillId", "idempotencyKey", "scenario", "contractId", "feed"]),
  "order timeout": Object.freeze(["actor", "drillId", "idempotencyKey", "scenario", "contractId", "feed", "orderId"]),
});

export const FUTURES_DRILL_SCENARIOS = Object.freeze([
  "missing mark price",
  "funding outage",
  "stream gap",
  "worker restart",
  "order timeout",
]);
export const FUTURES_DRILL_LIMITATIONS = Object.freeze([
  "timeout duration is NOT IN SOURCE",
  "a clock does not decide order timeout",
  "worker memory is not durable",
  "a drill does not cancel, fill, or retry an order",
  "a drill does not replace the pre-trade gate",
  "spot fallback is not used",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    status: error,
    scenario: null,
    alert: false,
    fault: null,
    reason: null,
    state: null,
    dataReconciled: false,
    stateReconciled: false,
    newRiskEnabled: false,
    positionQuantity: null,
    statedPositionQuantity: null,
    orderCreated: false,
    timeoutApplied: false,
    retried: false,
    restored: false,
    exposureIncreased: false,
    idempotentReplay: false,
    drillId: null,
    sequence: null,
    pnl: null,
    formula: null,
    position: null,
    limitations: FUTURES_DRILL_LIMITATIONS,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: null,
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

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function leaked(value) {
  return typeof value === "string" && (
    EMAIL.test(value)
    || /bearer\s+/i.test(value)
    || value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
  );
}

function containsSecret(value) {
  if (typeof value === "string") return leaked(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!plainObject(value)) return false;
  return Object.keys(value).some((key) => leaked(key) || containsSecret(value[key]));
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function actorOf(actor) {
  if (!plainObject(actor) || unknownKey(actor, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  const id = named(actor.id, "role scope denied");
  if (!id.ok) return id;
  const tenantId = named(actor.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (actor.role !== "Admin") return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function parseDecimal(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function format(part) {
  let digits = part.n.toString();
  if (part.scale > 0) {
    if (digits.length <= part.scale) digits = digits.padStart(part.scale + 1, "0");
    const cut = digits.length - part.scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${digits.slice(0, cut)}.${frac}` : digits.slice(0, cut);
  }
  return digits === "0" ? "0" : digits;
}

function addDec(leftText, rightText) {
  const left = parseDecimal(leftText);
  const right = parseDecimal(rightText);
  const scale = Math.max(left.scale, right.scale);
  return format({ n: scaleTo(left, scale) + scaleTo(right, scale), scale });
}

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  if (scaleTo(left, scale) < scaleTo(right, scale)) return -1;
  if (scaleTo(left, scale) > scaleTo(right, scale)) return 1;
  return 0;
}

function digitBig(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && DIGITS.test(value)) return BigInt(value);
  return null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function storesOf(stores) {
  return plainObject(stores)
    && unknownKey(stores, STORE_KEYS) === false
    && plainObject(stores.contracts)
    && stores.contracts.kind === "contract"
    && stores.contracts.contracts instanceof Map
    && plainObject(stores.futures)
    && stores.futures.orders instanceof Map
    && stores.futures.keys instanceof Map
    && stores.futures.positions instanceof Map
    && plainObject(stores.drills)
    && stores.drills.drills instanceof Map
    && stores.drills.keys instanceof Map
    && Array.isArray(stores.drills.alerts);
}

function drillStore(store) {
  return plainObject(store) && store.drills instanceof Map && store.keys instanceof Map && Array.isArray(store.alerts);
}

function spotShape(order) {
  if (!plainObject(order)) return false;
  if (order.product === "spot") return true;
  if (order.product !== "futures" && Object.hasOwn(order, "state")) return true;
  return false;
}

function requestKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function drillKey(tenantId, drillId) {
  return `${tenantId}\u0000${drillId}`;
}

function orderKey(tenantId, orderId) {
  return `${tenantId}\u0000${orderId}`;
}

function loadPosition(stores, actor, contractId) {
  const read = readFuturesPaperPosition(stores.futures, { actor, contractId });
  if (!read.ok) return { position: null, quantity: "0" };
  return { position: read.position, quantity: exposureOf(read.position) };
}

function exposureOf(position) {
  if (!position) return "0";
  return addDec(position.long ? position.long.quantity : "0", position.short ? position.short.quantity : "0");
}

function markMissing(feed) {
  if (!plainObject(feed) || !Object.hasOwn(feed, "mark")) return true;
  const mark = feed.mark;
  if (!plainObject(mark) || !Object.hasOwn(mark, "value")) return true;
  return mark.value == null || (typeof mark.value === "string" && mark.value.trim() === "");
}

function feedGap(feed) {
  if (!plainObject(feed)) return false;
  if (plainObject(feed.quality) && feed.quality.reason === "sequence gap") return true;
  if (feed.sequenceWatermark == null) return false;
  const sequence = digitBig(feed.sequence);
  const watermark = digitBig(feed.sequenceWatermark);
  if (sequence == null || watermark == null) return false;
  return sequence > watermark + 1n;
}

function observationGap(feed) {
  if (!plainObject(feed)) return false;
  return feedGap(feed.mark) || feedGap(feed.index) || feedGap(feed.funding);
}

function fundingOutage(evaluated) {
  return evaluated.ok === true && evaluated.alerts.some((item) => (
    item.fault === "stale funding" && item.reason === "outage"
  ));
}

function scenarioPresent(scenario, feed) {
  if (!plainObject(feed)) return { ok: false, error: "feed is not configured" };
  if (scenario === "missing mark price") {
    return markMissing(feed)
      ? { ok: true, present: true, reason: "missing mark price", state: "abstain" }
      : { ok: true, present: false, error: "mark price is present" };
  }
  if (scenario === "stream gap") {
    return observationGap(feed)
      ? { ok: true, present: true, reason: "sequence gap", state: "abstain" }
      : { ok: true, present: false, error: "stream gap is not present" };
  }
  if (scenario === "funding outage") {
    if (markMissing(feed)) return { ok: false, error: "mark price is not configured" };
    const evaluated = evaluateFuturesFaults(feed);
    if (!evaluated.ok) return { ok: false, error: evaluated.error };
    return fundingOutage(evaluated)
      ? { ok: true, present: true, reason: "outage", state: "abstain" }
      : { ok: true, present: false, error: "funding outage is not present" };
  }
  if (scenario === "worker restart") {
    return { ok: true, present: true, reason: "worker restart", state: "abstain" };
  }
  return { ok: true, present: true, reason: "unknown pending reconciliation", state: null };
}

function dataCleared(scenario, feed) {
  if (!plainObject(feed)) return { ok: false, error: "feed is not configured" };
  if (scenario === "missing mark price" && markMissing(feed)) return { ok: true, cleared: false };
  if (scenario === "stream gap" && observationGap(feed)) return { ok: true, cleared: false };
  if (markMissing(feed)) return { ok: true, cleared: false };
  const evaluated = evaluateFuturesFaults(feed);
  if (!evaluated.ok) return { ok: false, error: evaluated.error };
  if (scenario === "funding outage" && fundingOutage(evaluated)) return { ok: true, cleared: false };
  if (scenario === "stream gap" && observationGap(feed)) return { ok: true, cleared: false };
  if (evaluated.suppressed === true || evaluated.alerts.length > 0) return { ok: true, cleared: false };
  return { ok: true, cleared: true };
}

function publish(saved, replay) {
  const view = { ...saved, idempotentReplay: replay };
  delete view.tenantId;
  return deepFreeze(view);
}

function latch(drill) {
  const enabled = drill.dataReconciled === true && drill.stateReconciled === true;
  drill.newRiskEnabled = enabled;
  drill.alert = enabled !== true;
  if (enabled && drill.status !== "simulated" && drill.status !== "reduce-only close") {
    drill.status = "reconciled";
  }
  return drill;
}

function commit(store, actor, drill) {
  const saved = deepFreeze({
    ...latch(drill),
    timeoutApplied: false,
    retried: false,
    restored: false,
    idempotentReplay: false,
    limitations: FUTURES_DRILL_LIMITATIONS,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "futures",
    tenantId: actor.tenantId,
  });
  store.drills.set(drillKey(actor.tenantId, drill.drillId), saved);
  return saved;
}

export function createFuturesDrillStore() {
  return { drills: new Map(), keys: new Map(), alerts: Object.freeze([]) };
}

export function injectFuturesDrill(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || !Object.hasOwn(SCENARIO_KEYS, input.scenario)) return fail("unsupported field");
  if (unknownKey(input, SCENARIO_KEYS[input.scenario])) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const drillId = named(input.drillId, "drill is not configured");
  if (!drillId.ok) return fail(drillId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const contractId = named(input.contractId, "contract is not configured");
  if (!contractId.ok) return fail(contractId.error);
  if (!plainObject(input.feed)) return fail("feed is not configured");
  if (containsSecret(input)) return fail("secret value is not allowed");
  let orderId = null;
  if (input.scenario === "order timeout") {
    const namedOrder = named(input.orderId, "order is not configured");
    if (!namedOrder.ok) return fail(namedOrder.error);
    const existing = stores.futures.orders.get(orderKey(actor.actor.tenantId, namedOrder.value));
    if (!existing) return fail("order is not configured");
    if (existing.contractId !== contractId.value) return fail("contract does not match");
    orderId = namedOrder.value;
  }

  const body = {
    actorId: actor.actor.id,
    tenantId: actor.actor.tenantId,
    drillId: drillId.value,
    idempotencyKey: idempotencyKey.value,
    scenario: input.scenario,
    contractId: contractId.value,
    orderId,
    feed: input.feed,
  };
  const canonicalBody = JSON.stringify(stable(body));
  const prior = stores.drills.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (prior) {
    if (prior.canonical !== canonicalBody) return fail("idempotency key is already recorded");
    return publish(prior.saved, true);
  }
  if (stores.drills.drills.has(drillKey(actor.actor.tenantId, drillId.value))) {
    return fail("drill is already recorded");
  }
  const present = scenarioPresent(input.scenario, input.feed);
  if (!present.ok) return fail(present.error);
  if (!present.present) return fail(present.error);

  const position = loadPosition(stores, actor.actor, contractId.value);
  const status = input.scenario === "order timeout" ? "unknown pending reconciliation" : input.scenario;
  const drill = {
    ok: true,
    blocked: null,
    error: null,
    status,
    scenario: input.scenario,
    alert: true,
    fault: input.scenario,
    reason: present.reason,
    state: present.state,
    dataReconciled: false,
    stateReconciled: false,
    newRiskEnabled: false,
    positionQuantity: position.quantity,
    statedPositionQuantity: null,
    orderCreated: false,
    exposureIncreased: false,
    drillId: drillId.value,
    sequence: String(stores.drills.drills.size + 1),
    pnl: null,
    formula: null,
    position: position.position,
    contractId: contractId.value,
    orderId,
  };
  const saved = commit(stores.drills, actor.actor, drill);
  const alert = deepFreeze({
    drillId: drillId.value,
    scenario: input.scenario,
    fault: input.scenario,
    reason: present.reason,
    state: present.state,
    alert: true,
    sequence: saved.sequence,
  });
  stores.drills.alerts = Object.freeze([...stores.drills.alerts, alert]);
  stores.drills.keys.set(requestKey(actor.actor.tenantId, idempotencyKey.value), {
    canonical: canonicalBody,
    saved,
  });
  return publish(saved, false);
}

export function reconcileFuturesDrill(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, RECONCILE_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const drillId = named(input.drillId, "drill is not configured");
  if (!drillId.ok) return fail(drillId.error);
  if (input.data == null && input.state == null) return fail("reconciliation is not configured");
  if (input.data != null && !plainObject(input.data)) return fail("unsupported field");
  if (input.state != null && (!plainObject(input.state) || unknownKey(input.state, STATE_KEYS))) {
    return fail("unsupported field");
  }
  if (containsSecret(input)) return fail("secret value is not allowed");
  const saved = stores.drills.drills.get(drillKey(actor.actor.tenantId, drillId.value));
  if (!saved || saved.tenantId !== actor.actor.tenantId) return fail("drill is not configured");

  const next = { ...saved, position: null };
  if (input.data != null) {
    const cleared = dataCleared(saved.scenario, input.data);
    if (!cleared.ok) return fail(cleared.error);
    next.dataReconciled = cleared.cleared === true;
    if (!next.dataReconciled) next.status = "data is not reconciled";
  }
  if (input.state != null) {
    const stated = named(input.state.positionQuantity, "position quantity is not configured");
    if (!stated.ok) return fail(stated.error);
    if (!parseDecimal(stated.value)) return fail("unsupported field");
    const live = loadPosition(stores, actor.actor, saved.contractId);
    next.positionQuantity = live.quantity;
    next.position = live.position;
    next.statedPositionQuantity = stated.value;
    if (stated.value !== live.quantity) {
      next.stateReconciled = false;
      next.status = "position quantity does not match";
      next.ok = false;
      next.blocked = "BLOCKED";
      next.error = "position quantity does not match";
      return publish(commit(stores.drills, actor.actor, next), false);
    }
    next.stateReconciled = true;
    next.error = null;
    next.blocked = null;
    next.ok = true;
  }
  if (next.dataReconciled !== true) next.status = next.status === "position quantity does not match"
    ? next.status
    : "data is not reconciled";
  else if (next.stateReconciled !== true) next.status = "state is not reconciled";
  const stored = commit(stores.drills, actor.actor, next);
  return publish(stored, false);
}

function blockedAttempt(drill, position, status) {
  return {
    ok: false,
    blocked: "BLOCKED",
    error: status,
    status,
    scenario: drill.scenario,
    alert: drill.alert,
    fault: drill.fault,
    reason: drill.reason,
    state: drill.state,
    dataReconciled: drill.dataReconciled,
    stateReconciled: drill.stateReconciled,
    newRiskEnabled: false,
    positionQuantity: position.quantity,
    statedPositionQuantity: drill.statedPositionQuantity,
    orderCreated: false,
    exposureIncreased: false,
    drillId: drill.drillId,
    sequence: drill.sequence,
    pnl: null,
    formula: null,
    position: position.position,
    contractId: drill.contractId,
    orderId: drill.orderId,
    timeoutApplied: false,
    retried: false,
    restored: false,
    limitations: FUTURES_DRILL_LIMITATIONS,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "futures",
  };
}

export function attemptFuturesDrillOrder(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, ATTEMPT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const drillId = named(input.drillId, "drill is not configured");
  if (!drillId.ok) return fail(drillId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  if (!plainObject(input.order)) return fail("unsupported field");
  if (spotShape(input.order)) return fail("product is not supported");
  if (containsSecret(input)) return fail("secret value is not allowed");
  if (unknownKey(input.order, ORDER_KEYS) || input.order.product !== "futures") {
    return fail(input.order.product === "futures" ? "unsupported field" : "product is not supported");
  }
  if (input.order.reduceOnly == null) return fail("reduce-only is not configured");
  if (typeof input.order.reduceOnly !== "boolean") return fail("unsupported field");
  const saved = stores.drills.drills.get(drillKey(actor.actor.tenantId, drillId.value));
  if (!saved || saved.tenantId !== actor.actor.tenantId) return fail("drill is not configured");
  if (input.order.contractId !== saved.contractId) return fail("contract does not match");
  const position = loadPosition(stores, actor.actor, saved.contractId);
  const timeoutRetry = saved.scenario === "order timeout" && orderId.value === saved.orderId;
  const latched = saved.newRiskEnabled !== true;
  const reducing = input.order.reduceOnly === true && REDUCE_WHILE_LATCHED.has(saved.scenario);
  if (timeoutRetry || (latched && !reducing)) {
    const status = saved.scenario === "order timeout" ? "unknown pending reconciliation" : "new risk disabled";
    return publish(blockedAttempt(saved, position, status), false);
  }
  const beforeOrders = stores.futures.orders.size;
  const appended = appendFuturesPaperOrder(stores, {
    actor: actor.actor,
    orderId: orderId.value,
    idempotencyKey: idempotencyKey.value,
    contractId: saved.contractId,
    direction: input.order.direction,
    quantity: input.order.quantity,
    price: input.order.price,
    reduceOnly: input.order.reduceOnly,
    positionMode: input.order.positionMode,
    marginMode: input.order.marginMode,
    product: "futures",
  });
  if (!appended.ok) return publish(blockedAttempt(saved, position, appended.error), false);
  const after = loadPosition(stores, actor.actor, saved.contractId);
  const beforePart = parseDecimal(position.quantity);
  const afterPart = parseDecimal(after.quantity);
  const next = {
    ...saved,
    position: after.position,
    positionQuantity: after.quantity,
    pnl: appended.pnl,
    formula: appended.formula,
    orderCreated: stores.futures.orders.size > beforeOrders,
    exposureIncreased: Boolean(beforePart && afterPart && compare(afterPart, beforePart) > 0),
    ok: true,
    blocked: null,
    error: null,
    status: input.order.reduceOnly ? "reduce-only close" : "simulated",
    stateReconciled: input.order.reduceOnly ? false : saved.stateReconciled,
  };
  return publish(commit(stores.drills, actor.actor, next), false);
}

export function readFuturesDrill(store, input) {
  if (!drillStore(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const drillId = named(input.drillId, "drill is not configured");
  if (!drillId.ok) return fail(drillId.error);
  const saved = store.drills.get(drillKey(actor.actor.tenantId, drillId.value));
  if (!saved || saved.tenantId !== actor.actor.tenantId) return fail("drill is not configured");
  return publish(saved, false);
}
