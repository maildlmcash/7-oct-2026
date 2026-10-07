// Futures liquidation and reduce-only cases for TASK 15.B.02.
// Margin deterioration and a liquidation-distance warning use the caller
// readings. The source names no liquidation price and no distance formula.
// A warning stops an order that is not a reduce-only close. A reduce-only
// close decreases an open matching side and never opens a side. A position
// mode mismatch stops before any quantity change. This module does not
// synthesize a liquidation order and does not open a venue client.

import { POSITION_MODES } from "./derivatives-features.mjs";
import { appendFuturesPaperOrder, readFuturesPaperPosition } from "./futures-paper.mjs";
import {
  FUTURES_RISK_ACTION,
  LIQUIDATION_DISTANCE_FORMULA,
  readFuturesRisk,
} from "./futures-risk.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const INPUT_KEYS = Object.freeze([
  "actor",
  "caseId",
  "idempotencyKey",
  "orderId",
  "kind",
  "priorMaintenanceMarginBuffer",
  "priorLiquidationDistance",
  "risk",
  "order",
]);
const READ_KEYS = Object.freeze(["actor", "caseId"]);
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
const STORE_KEYS = Object.freeze(["contracts", "futures", "liquidation"]);
const MARGIN_MODES = new Set(["isolated", "cross"]);
const DIRECTIONS = new Set(["long", "short"]);
const BUFFER_FLOOR = "maintenance-margin buffer is not met";
const DISTANCE_FLOOR = "liquidation distance is below the floor";

export const FUTURES_LIQUIDATION_KINDS = Object.freeze([
  "margin deterioration",
  "liquidation-distance warning",
  "reduce-only close",
  "position-mode mismatch",
]);
export const FUTURES_LIQUIDATION_ASSUMPTIONS = Object.freeze([
  "margin deterioration means the caller maintenance-margin buffer is below its prior reading or below its floor",
  "liquidation-distance warning means the caller liquidation distance is below its prior reading or below its floor",
  "neither reading is derived from mark, leverage, or price",
  "reduce-only close decreases an open matching side",
  "a case that is not a reduce-only close does not change quantity",
]);
export const FUTURES_LIQUIDATION_LIMITATIONS = Object.freeze([
  "liquidation price is NOT IN SOURCE",
  "liquidation distance formula is NOT IN SOURCE",
  "maintenance margin formula is NOT IN SOURCE",
  "a liquidation order is not synthesized",
  "fee is NOT IN SOURCE",
  "funding payment is NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    status: error,
    warnings: Object.freeze([]),
    action: FUTURES_RISK_ACTION,
    exposureIncreased: false,
    exposureReduced: false,
    exposureBefore: null,
    exposureAfter: null,
    position: null,
    pnl: null,
    formula: null,
    orderCreated: false,
    idempotentReplay: false,
    caseId: null,
    sequence: null,
    maintenanceMarginBuffer: null,
    priorMaintenanceMarginBuffer: null,
    liquidationDistance: null,
    priorLiquidationDistance: null,
    liquidationDistanceFormula: LIQUIDATION_DISTANCE_FORMULA,
    assumptions: FUTURES_LIQUIDATION_ASSUMPTIONS,
    limitations: FUTURES_LIQUIDATION_LIMITATIONS,
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

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  if (scaleTo(left, scale) < scaleTo(right, scale)) return -1;
  if (scaleTo(left, scale) > scaleTo(right, scale)) return 1;
  return 0;
}

function addDec(leftText, rightText) {
  const left = parseDecimal(leftText);
  const right = parseDecimal(rightText);
  const scale = Math.max(left.scale, right.scale);
  return format({
    n: scaleTo(left, scale) + scaleTo(right, scale),
    scale,
  });
}

function decimalField(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  const parsed = parseDecimal(value);
  if (!parsed) return { ok: false, error: "unsupported field" };
  return { ok: true, value, parsed };
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
    && plainObject(stores.liquidation)
    && stores.liquidation.cases instanceof Map
    && stores.liquidation.keys instanceof Map;
}

function caseStore(store) {
  return plainObject(store) && store.cases instanceof Map && store.keys instanceof Map;
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

function caseKey(tenantId, caseId) {
  return `${tenantId}\u0000${caseId}`;
}

function exposureOf(position) {
  if (!position) return "0";
  return addDec(position.long ? position.long.quantity : "0", position.short ? position.short.quantity : "0");
}

function loadPosition(stores, actor, contractId) {
  const read = readFuturesPaperPosition(stores.futures, { actor, contractId });
  if (!read.ok) return null;
  return read.position;
}

function warningsOf(buffer, priorBuffer, floor, distance, priorDistance, distanceFloor) {
  const warnings = [];
  if (compare(buffer, priorBuffer) < 0 || compare(buffer, floor) < 0) warnings.push("margin deterioration");
  if (compare(distance, priorDistance) < 0 || compare(distance, distanceFloor) < 0) {
    warnings.push("liquidation-distance warning");
  }
  return warnings;
}

function pureReduce(position, order) {
  if (order.reduceOnly !== true) return { ok: false, error: "reduce-only is not set" };
  if (!position || (!position.long && !position.short)) return { ok: false, error: "reduce-only has no position" };
  if (position.positionMode !== order.positionMode) return { ok: false, error: "position mode does not match" };
  if (position.marginMode !== order.marginMode) return { ok: false, error: "margin mode does not match" };
  const bucket = position[order.direction];
  if (position.positionMode !== "hedge") {
    const side = position.long ? "long" : "short";
    if (side !== order.direction || !bucket) return { ok: false, error: "reduce-only side does not match" };
  } else if (!bucket) {
    return { ok: false, error: "reduce-only has no position" };
  }
  const have = parseDecimal(bucket.quantity);
  const need = parseDecimal(order.quantity);
  if (!have || !need || need.n === 0n) return { ok: false, error: "unsupported field" };
  if (compare(need, have) > 0) return { ok: false, error: "reduce-only quantity is larger than the position" };
  return { ok: true };
}

function blocksClose(risk) {
  if (risk.ok) return null;
  if (risk.error === BUFFER_FLOOR || risk.error === DISTANCE_FLOOR) return null;
  return risk.error;
}

function publish(saved, replay) {
  const view = { ...saved, idempotentReplay: replay };
  delete view.tenantId;
  return deepFreeze(view);
}

function record(store, actor, input, canonicalBody, outcome) {
  const saved = deepFreeze({
    ...outcome,
    idempotentReplay: false,
    caseId: input.caseId,
    sequence: String(store.cases.size + 1),
    assumptions: FUTURES_LIQUIDATION_ASSUMPTIONS,
    limitations: FUTURES_LIQUIDATION_LIMITATIONS,
    liquidationDistanceFormula: LIQUIDATION_DISTANCE_FORMULA,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "futures",
    tenantId: actor.tenantId,
  });
  store.cases.set(caseKey(actor.tenantId, input.caseId), saved);
  store.keys.set(requestKey(actor.tenantId, input.idempotencyKey), {
    canonical: canonicalBody,
    saved,
  });
  return saved;
}

function stopped(status, position, warnings, readings) {
  const exposure = exposureOf(position);
  return {
    ok: false,
    blocked: "BLOCKED",
    error: status,
    status,
    warnings: Object.freeze([...warnings]),
    action: FUTURES_RISK_ACTION,
    exposureIncreased: false,
    exposureReduced: false,
    exposureBefore: exposure,
    exposureAfter: exposure,
    position,
    pnl: null,
    formula: null,
    orderCreated: false,
    maintenanceMarginBuffer: readings.buffer,
    priorMaintenanceMarginBuffer: readings.priorBuffer,
    liquidationDistance: readings.distance,
    priorLiquidationDistance: readings.priorDistance,
  };
}

export function createFuturesLiquidationStore() {
  return { cases: new Map(), keys: new Map() };
}

export function runFuturesLiquidationCase(stores, input) {
  if (!storesOf(stores)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, INPUT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const caseId = named(input.caseId, "case is not configured");
  if (!caseId.ok) return fail(caseId.error);
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(idempotencyKey.error);
  const orderId = named(input.orderId, "order is not configured");
  if (!orderId.ok) return fail(orderId.error);
  if (input.kind == null || input.kind === "") return fail("case is not configured");
  if (!FUTURES_LIQUIDATION_KINDS.includes(input.kind)) return fail("unsupported field");
  const priorBuffer = decimalField(input.priorMaintenanceMarginBuffer, "prior margin is not configured");
  if (!priorBuffer.ok) return fail(priorBuffer.error);
  const priorDistance = decimalField(input.priorLiquidationDistance, "prior liquidation distance is not configured");
  if (!priorDistance.ok) return fail(priorDistance.error);
  if (!plainObject(input.risk) || !plainObject(input.order)) return fail("unsupported field");
  if (spotShape(input.order)) return fail("product is not supported");
  if (containsSecret(input)) return fail("secret value is not allowed");
  if (unknownKey(input.order, ORDER_KEYS) || input.order.product !== "futures") {
    return fail(input.order.product === "futures" ? "unsupported field" : "product is not supported");
  }
  if (input.order.reduceOnly == null) return fail("reduce-only is not configured");
  if (typeof input.order.reduceOnly !== "boolean") return fail("unsupported field");
  if (input.order.direction == null || input.order.direction === "") return fail("direction is not configured");
  if (!DIRECTIONS.has(input.order.direction)) return fail("unsupported field");
  if (!POSITION_MODES.includes(input.order.positionMode)) {
    return fail(input.order.positionMode ? "unsupported field" : "position mode is not configured");
  }
  if (!MARGIN_MODES.has(input.order.marginMode)) {
    return fail(input.order.marginMode ? "unsupported field" : "margin mode is not configured");
  }
  const quantity = parseDecimal(input.order.quantity);
  const price = parseDecimal(input.order.price);
  if (!quantity || quantity.n === 0n || !price || price.n === 0n) return fail("unsupported field");

  const body = {
    actor: actor.actor,
    caseId: caseId.value,
    idempotencyKey: idempotencyKey.value,
    orderId: orderId.value,
    kind: input.kind,
    priorMaintenanceMarginBuffer: priorBuffer.value,
    priorLiquidationDistance: priorDistance.value,
    risk: input.risk,
    order: input.order,
  };
  const canonicalBody = JSON.stringify(stable({
    actorId: body.actor.id,
    tenantId: body.actor.tenantId,
    caseId: body.caseId,
    idempotencyKey: body.idempotencyKey,
    orderId: body.orderId,
    kind: body.kind,
    priorMaintenanceMarginBuffer: body.priorMaintenanceMarginBuffer,
    priorLiquidationDistance: body.priorLiquidationDistance,
    risk: body.risk,
    order: body.order,
  }));
  const prior = stores.liquidation.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (prior) {
    if (prior.canonical !== canonicalBody) return fail("idempotency key is already recorded");
    return publish(prior.saved, true);
  }
  if (stores.liquidation.cases.has(caseKey(actor.actor.tenantId, caseId.value))) {
    return fail("case is already recorded");
  }

  const risk = readFuturesRisk(input.risk);
  if (risk.maintenanceMarginBuffer == null || risk.liquidationDistance == null) return fail(risk.error);
  const buffer = parseDecimal(risk.maintenanceMarginBuffer);
  const floor = parseDecimal(risk.maintenanceMarginBufferFloor);
  const distance = parseDecimal(risk.liquidationDistance);
  const distanceFloor = parseDecimal(risk.liquidationDistanceFloor);
  if (!buffer || !floor || !distance || !distanceFloor) return fail("unsupported field");
  const readings = {
    buffer: risk.maintenanceMarginBuffer,
    priorBuffer: priorBuffer.value,
    distance: risk.liquidationDistance,
    priorDistance: priorDistance.value,
  };
  const warnings = warningsOf(buffer, priorBuffer.parsed, floor, distance, priorDistance.parsed, distanceFloor);
  const position = loadPosition(stores, actor.actor, input.order.contractId);
  let outcome;
  if (input.kind === "margin deterioration") {
    outcome = stopped(
      warnings.includes("margin deterioration") ? "margin deterioration" : "margin has not deteriorated",
      position,
      warnings,
      readings,
    );
  } else if (input.kind === "liquidation-distance warning") {
    outcome = stopped(
      warnings.includes("liquidation-distance warning")
        ? "liquidation-distance warning"
        : "liquidation distance is not a warning",
      position,
      warnings,
      readings,
    );
  } else if (input.kind === "position-mode mismatch") {
    let status = "position is not open";
    if (position && (position.long || position.short)) {
      status = position.positionMode === input.order.positionMode
        ? "position mode matches"
        : "position mode does not match";
    }
    outcome = stopped(status, position, warnings, readings);
  } else {
    const gate = blocksClose(risk);
    const plan = pureReduce(position, input.order);
    if (gate) outcome = stopped(gate, position, warnings, readings);
    else if (!plan.ok) outcome = stopped(plan.error, position, warnings, readings);
    else {
      const before = exposureOf(position);
      const appended = appendFuturesPaperOrder(stores, {
        actor: actor.actor,
        orderId: orderId.value,
        idempotencyKey: idempotencyKey.value,
        contractId: input.order.contractId,
        direction: input.order.direction,
        quantity: input.order.quantity,
        price: input.order.price,
        reduceOnly: true,
        positionMode: input.order.positionMode,
        marginMode: input.order.marginMode,
        product: "futures",
      });
      if (!appended.ok) outcome = stopped(appended.error, position, warnings, readings);
      else {
        const after = exposureOf(appended.position);
        outcome = {
          ok: true,
          blocked: null,
          error: null,
          status: "reduce-only close",
          warnings: Object.freeze([...warnings]),
          action: null,
          exposureIncreased: compare(parseDecimal(after), parseDecimal(before)) > 0,
          exposureReduced: compare(parseDecimal(after), parseDecimal(before)) < 0,
          exposureBefore: before,
          exposureAfter: after,
          position: appended.position,
          pnl: appended.pnl,
          formula: appended.formula,
          orderCreated: true,
          maintenanceMarginBuffer: readings.buffer,
          priorMaintenanceMarginBuffer: readings.priorBuffer,
          liquidationDistance: readings.distance,
          priorLiquidationDistance: readings.priorDistance,
        };
      }
    }
  }
  return publish(record(stores.liquidation, actor.actor, body, canonicalBody, outcome), false);
}

export function readFuturesLiquidationCase(store, input) {
  if (!caseStore(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const caseId = named(input.caseId, "case is not configured");
  if (!caseId.ok) return fail(caseId.error);
  const saved = store.cases.get(caseKey(actor.actor.tenantId, caseId.value));
  if (!saved || saved.tenantId !== actor.actor.tenantId) return fail("case is not configured");
  return publish(saved, false);
}
