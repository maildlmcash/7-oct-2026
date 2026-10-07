// Paper order lifecycle for TASK 14.A.01.
// The states are create, acknowledge, partial fill, fill, cancel, reject,
// timeout, and reconcile. Each request appends one frozen event.
// The same idempotency key and the same body return the stored event.
// A different body does not replace it.
// The source names no fill quantity, no timeout duration, and no balance formula.
// This module does not open a venue client and does not read LIVE_TRADING
// from the environment. Live orders stay locked.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze(["actor", "orderId", "idempotencyKey", "state", "product"]);
const READ_KEYS = Object.freeze(["actor", "orderId"]);
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);

export const PAPER_ORDER_MODE = "paper";
export const PAPER_ORDER_PRODUCT = "spot";
export const PAPER_ORDER_STATES = Object.freeze([
  "create",
  "acknowledge",
  "partial fill",
  "fill",
  "cancel",
  "reject",
  "timeout",
  "reconcile",
]);
export const PAPER_ORDER_LIMITATIONS = Object.freeze([
  "fill quantity is NOT IN SOURCE",
  "timeout duration is NOT IN SOURCE",
  "balance reconciliation is NOT IN SOURCE",
]);

const NEXT = Object.freeze({
  "": Object.freeze(["create"]),
  create: Object.freeze(["acknowledge", "cancel", "reject", "timeout", "reconcile"]),
  acknowledge: Object.freeze(["partial fill", "fill", "cancel", "timeout", "reconcile"]),
  "partial fill": Object.freeze(["partial fill", "fill", "cancel", "timeout", "reconcile"]),
  fill: Object.freeze(["reconcile"]),
  cancel: Object.freeze(["reconcile"]),
  reject: Object.freeze(["reconcile"]),
  timeout: Object.freeze(["reconcile"]),
  reconcile: Object.freeze([]),
});

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    idempotentReplay: false,
    event: null,
    order: null,
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

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
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

function orderKey(tenantId, orderId) {
  return `${tenantId}\u0000${orderId}`;
}

function requestKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function canonical(event) {
  return JSON.stringify({
    actorId: event.actorId,
    orderId: event.orderId,
    product: event.product,
    state: event.state,
  });
}

function snapshot(record) {
  const last = record.events[record.events.length - 1];
  return deepFreeze({
    orderId: record.orderId,
    product: record.product,
    mode: PAPER_ORDER_MODE,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    state: last.state,
    events: record.events,
    limitations: PAPER_ORDER_LIMITATIONS,
  });
}

function success(event, record, replay) {
  return deepFreeze({
    ok: true,
    blocked: null,
    error: null,
    idempotentReplay: replay,
    event,
    order: snapshot(record),
  });
}

export function createPaperOrderStore() {
  return { orders: new Map(), keys: new Map() };
}

export function appendPaperOrder(store, input) {
  if (!store || !(store.orders instanceof Map) || !(store.keys instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const product = named(input.product, "product is not configured");
  if (!product.ok) return fail(product.error);
  if (product.value !== PAPER_ORDER_PRODUCT) return fail("product is not supported");
  const state = named(input.state, "state is not configured");
  if (!state.ok) return fail(state.error);
  if (!PAPER_ORDER_STATES.includes(state.value)) return fail("unsupported field");

  const body = {
    actorId: actor.actor.id,
    orderId: orderId.value,
    product: product.value,
    state: state.value,
  };
  const storedKey = store.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (storedKey) {
    if (storedKey.canonical !== canonical(body)) return fail("idempotency key is already recorded");
    const record = store.orders.get(orderKey(actor.actor.tenantId, orderId.value));
    return success(storedKey.event, record, true);
  }

  const key = orderKey(actor.actor.tenantId, orderId.value);
  const existing = store.orders.get(key);
  const current = existing ? existing.events[existing.events.length - 1].state : "";
  if (state.value === "create" && existing) return fail("order is already recorded");
  if (!NEXT[current].includes(state.value)) return fail("transition is not allowed");
  if (existing && existing.product !== product.value) return fail("product is not supported");

  const event = deepFreeze({
    orderId: orderId.value,
    idempotencyKey: idempotencyKey.value,
    state: state.value,
    product: product.value,
    mode: PAPER_ORDER_MODE,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    sequence: String((existing ? existing.events.length : 0) + 1),
    actorId: actor.actor.id,
  });
  const events = Object.freeze([...(existing ? existing.events : []), event]);
  const record = existing ?? {
    orderId: orderId.value,
    tenantId: actor.actor.tenantId,
    product: product.value,
    events,
  };
  record.events = events;
  store.orders.set(key, record);
  store.keys.set(requestKey(actor.actor.tenantId, idempotencyKey.value), {
    canonical: canonical(body),
    event,
  });
  return success(event, record, false);
}

export function readPaperOrder(store, input) {
  if (!store || !(store.orders instanceof Map) || !(store.keys instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  const record = store.orders.get(orderKey(actor.actor.tenantId, orderId.value));
  if (!record || record.tenantId !== actor.actor.tenantId) return fail("order is not configured");
  return success(record.events[record.events.length - 1], record, false);
}
