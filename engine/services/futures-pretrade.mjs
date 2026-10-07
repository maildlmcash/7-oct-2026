// Futures pre-trade checks for TASK 15.A.02.
// The checks run before a futures paper order is simulated.
// Max leverage, notional, the maintenance-margin buffer, and liquidation
// distance come from readFuturesRisk. Mark/index freshness and funding state
// come from evaluateFuturesFaults. The source names no cap numbers, no
// liquidation-distance formula, and no stop price. A stale mark or index
// blocks a new entry and does not block a reduce-only exit. A funding fault
// blocks the order. The kill switch blocks a new risk-increasing order and
// does not cancel an open paper order. This module does not open a venue client.

import { evaluateFuturesFaults } from "./futures-faults.mjs";
import { appendFuturesPaperOrder } from "./futures-paper.mjs";
import { FUTURES_RISK_ACTION, readFuturesRisk } from "./futures-risk.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const INPUT_KEYS = Object.freeze([
  "actor",
  "decisionId",
  "idempotencyKey",
  "orderId",
  "killSwitch",
  "stopPolicy",
  "risk",
  "feed",
  "order",
]);
const READ_KEYS = Object.freeze(["actor", "decisionId"]);
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
const STOP_KEYS = Object.freeze(["configured"]);
const RISK_REASON = Object.freeze({
  "leverage cap is exceeded": "max leverage",
  "leverage is not configured": "max leverage",
  "max leverage is not configured": "max leverage",
  "notional cap is exceeded": "notional",
  "notional is not configured": "notional",
  "max notional is not configured": "notional",
  "maintenance-margin buffer is not met": "margin buffer",
  "maintenance-margin buffer is not configured": "margin buffer",
  "maintenance-margin buffer floor is not configured": "margin buffer",
  "liquidation distance is below the floor": "liquidation distance",
  "liquidation distance is not configured": "liquidation distance",
  "liquidation-distance floor is not configured": "liquidation distance",
});

export const FUTURES_PRETRADE_REASON_CODES = Object.freeze([
  "max leverage",
  "notional",
  "margin buffer",
  "mark/index freshness",
  "funding state",
  "liquidation distance",
  "stop policy",
  "kill switch",
]);
export const FUTURES_PRETRADE_LIMITATIONS = Object.freeze([
  "leverage ceiling number is NOT IN SOURCE",
  "notional is caller-supplied and is not derived from price times quantity",
  "liquidation distance formula is NOT IN SOURCE",
  "stop price is NOT IN SOURCE",
  "funding payment is NOT IN SOURCE",
  "open-interest discontinuity is not a pre-trade veto",
  "liquidation-feed outage is not a pre-trade veto",
  "audit timestamp is NOT IN SOURCE",
  "kill switch does not cancel, fill, or reconcile",
]);

function fail(error, reasonCode = error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    reasonCode,
    action: FUTURES_RISK_ACTION,
    orderCreated: false,
    idempotentReplay: false,
    audit: null,
    order: null,
    position: null,
    pnl: null,
    formula: null,
    feedReason: null,
    leverageAssumption: null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: null,
    limitations: FUTURES_PRETRADE_LIMITATIONS,
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
    && unknownKey(stores, ["contracts", "futures", "pretrade"]) === false
    && plainObject(stores.contracts)
    && stores.contracts.kind === "contract"
    && stores.contracts.contracts instanceof Map
    && plainObject(stores.futures)
    && stores.futures.orders instanceof Map
    && stores.futures.keys instanceof Map
    && stores.futures.positions instanceof Map
    && plainObject(stores.pretrade)
    && stores.pretrade.decisions instanceof Map
    && stores.pretrade.keys instanceof Map
    && Array.isArray(stores.pretrade.audits);
}

function spotShape(order) {
  if (order.product === "spot") return true;
  if (order.product !== "futures" && Object.hasOwn(order, "state")) return true;
  return false;
}

function decisionKey(tenantId, decisionId) {
  return `${tenantId}\u0000${decisionId}`;
}

function requestKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function publish(saved, replay) {
  const view = { ...saved, idempotentReplay: replay };
  delete view.tenantId;
  return deepFreeze(view);
}

function veto(error, reasonCode, extra = {}) {
  return {
    ok: false,
    error,
    reasonCode,
    action: FUTURES_RISK_ACTION,
    orderCreated: false,
    order: null,
    position: null,
    pnl: null,
    formula: null,
    feedReason: extra.feedReason ?? null,
    leverageAssumption: extra.leverageAssumption ?? null,
    product: null,
  };
}

function evaluate(input) {
  if (input.stopPolicy.configured !== true) {
    return veto("stop policy is not configured", "stop policy");
  }
  const risk = readFuturesRisk(input.risk);
  if (!risk.ok) {
    return veto(risk.error, RISK_REASON[risk.error] ?? risk.error, {
      leverageAssumption: risk.leverageAssumption,
    });
  }
  const feed = evaluateFuturesFaults(input.feed);
  if (!feed.ok) return veto(feed.error, feed.error);
  const mark = feed.alerts.find((item) => item.fault === "stale mark/index");
  if (mark && input.order.reduceOnly === false) {
    return veto("stale mark/index", "mark/index freshness", {
      feedReason: mark.reason,
      leverageAssumption: risk.leverageAssumption,
    });
  }
  const funding = feed.alerts.find((item) => item.fault === "stale funding" || item.fault === "funding gap");
  if (funding) {
    return veto(funding.fault, "funding state", {
      feedReason: funding.reason,
      leverageAssumption: risk.leverageAssumption,
    });
  }
  if (input.killSwitch === true && input.order.reduceOnly === false) {
    return veto("kill switch is on", "kill switch", {
      leverageAssumption: risk.leverageAssumption,
    });
  }
  return {
    ok: true,
    error: null,
    reasonCode: null,
    action: null,
    orderCreated: true,
    leverageAssumption: risk.leverageAssumption,
    feedReason: null,
  };
}

function savedOf(actor, input, verdict, audit) {
  return {
    ok: verdict.ok === true && verdict.orderCreated === true,
    blocked: verdict.orderCreated === true ? null : "BLOCKED",
    error: verdict.error ?? null,
    reasonCode: verdict.reasonCode ?? null,
    action: verdict.orderCreated === true ? null : FUTURES_RISK_ACTION,
    orderCreated: verdict.orderCreated === true,
    audit,
    order: verdict.order ?? null,
    position: verdict.position ?? null,
    pnl: verdict.pnl ?? null,
    formula: verdict.formula ?? null,
    feedReason: verdict.feedReason ?? null,
    leverageAssumption: verdict.leverageAssumption ?? null,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: verdict.orderCreated === true ? "futures" : null,
    limitations: FUTURES_PRETRADE_LIMITATIONS,
    tenantId: actor.tenantId,
  };
}

function record(store, actor, input, canonicalBody, verdict) {
  const audit = deepFreeze({
    decisionId: input.decisionId,
    idempotencyKey: input.idempotencyKey,
    orderId: input.orderId,
    actorId: actor.id,
    role: actor.role,
    tenantId: actor.tenantId,
    reasonCode: verdict.reasonCode ?? null,
    error: verdict.error ?? null,
    action: verdict.orderCreated === true ? null : FUTURES_RISK_ACTION,
    orderCreated: verdict.orderCreated === true,
    killSwitch: input.killSwitch,
    reduceOnly: input.order.reduceOnly,
    feedReason: verdict.feedReason ?? null,
    leverageAssumption: verdict.leverageAssumption ?? null,
    sequence: String(store.audits.length + 1),
  });
  const saved = deepFreeze(savedOf(actor, input, verdict, audit));
  store.audits = Object.freeze([...store.audits, audit]);
  store.decisions.set(decisionKey(actor.tenantId, input.decisionId), saved);
  store.keys.set(requestKey(actor.tenantId, input.idempotencyKey), {
    canonical: canonicalBody,
    saved,
  });
  return saved;
}

export function createFuturesPreTradeStore() {
  return { decisions: new Map(), keys: new Map(), audits: Object.freeze([]) };
}

export function checkFuturesPreTrade(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const decisionId = named(input.decisionId, "decision is not configured");
  if (!decisionId.ok) return fail(decisionId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  if (typeof input.killSwitch !== "boolean") return fail("kill switch is not configured", "kill switch");
  if (!plainObject(input.stopPolicy) || unknownKey(input.stopPolicy, STOP_KEYS)) {
    return fail("stop policy is not configured", "stop policy");
  }
  if (typeof input.stopPolicy.configured !== "boolean") {
    return fail("stop policy is not configured", "stop policy");
  }
  if (!plainObject(input.risk) || !plainObject(input.feed) || !plainObject(input.order)) {
    return fail("unsupported field");
  }
  if (spotShape(input.order)) return fail("product is not supported");
  if (unknownKey(input.order, ORDER_KEYS) || input.order.product !== "futures") {
    return fail(input.order.product === "futures" ? "unsupported field" : "product is not supported");
  }
  if (input.order.reduceOnly == null) return fail("reduce-only is not configured");
  if (typeof input.order.reduceOnly !== "boolean") return fail("unsupported field");
  if (containsSecret(input)) return fail("secret value is not allowed");

  const body = {
    ...input,
    decisionId: decisionId.value,
    idempotencyKey: idempotencyKey.value,
    orderId: orderId.value,
  };
  const canonicalBody = JSON.stringify(stable({
    actorId: actor.actor.id,
    tenantId: actor.actor.tenantId,
    decisionId: body.decisionId,
    idempotencyKey: body.idempotencyKey,
    orderId: body.orderId,
    killSwitch: body.killSwitch,
    stopPolicy: body.stopPolicy,
    risk: body.risk,
    feed: body.feed,
    order: body.order,
  }));
  const prior = stores.pretrade.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (prior) {
    if (prior.canonical !== canonicalBody) return fail("idempotency key is already recorded");
    return publish(prior.saved, true);
  }
  if (stores.pretrade.decisions.has(decisionKey(actor.actor.tenantId, decisionId.value))) {
    return fail("decision is already recorded");
  }

  const verdict = evaluate(body);
  if (!verdict.ok) {
    return publish(record(stores.pretrade, actor.actor, body, canonicalBody, verdict), false);
  }
  const appended = appendFuturesPaperOrder(
    { contracts: stores.contracts, futures: stores.futures },
    {
      actor: actor.actor,
      orderId: orderId.value,
      idempotencyKey: idempotencyKey.value,
      contractId: body.order.contractId,
      direction: body.order.direction,
      quantity: body.order.quantity,
      price: body.order.price,
      reduceOnly: body.order.reduceOnly,
      positionMode: body.order.positionMode,
      marginMode: body.order.marginMode,
      product: "futures",
    },
  );
  if (!appended.ok) {
    return publish(record(stores.pretrade, actor.actor, body, canonicalBody, {
      ...verdict,
      ok: false,
      orderCreated: false,
      error: appended.error,
      reasonCode: appended.error,
      action: FUTURES_RISK_ACTION,
    }), false);
  }
  return publish(record(stores.pretrade, actor.actor, body, canonicalBody, {
    ...verdict,
    orderCreated: true,
    order: appended.order,
    position: appended.position,
    pnl: appended.pnl,
    formula: appended.formula,
  }), false);
}

export function readFuturesPreTrade(store, input) {
  if (!plainObject(store) || !(store.decisions instanceof Map) || !Array.isArray(store.audits)) {
    return fail("unsupported field");
  }
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const decisionId = named(input.decisionId, "decision is not configured");
  if (!decisionId.ok) return fail(decisionId.error);
  const saved = store.decisions.get(decisionKey(actor.actor.tenantId, decisionId.value));
  if (!saved || saved.tenantId !== actor.actor.tenantId) return fail("decision is not configured");
  return publish(saved, false);
}
