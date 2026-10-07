// Paper decision gate for TASK 14.A.02.
// A versioned Spot score is connected to a paper order only when data and risk
// are both approved. Data approval is a passing feature-quality check and a
// scored model version. Risk approval is a kill switch that is off, a notional
// at or under the caller max, and a fee the execution-cost walk accepts.
// The source names no expected move, no no-trade band, and no safety buffer.
// Other limit rules are NOT IN SOURCE. Live orders stay locked.
// This module does not open a venue client.

import { scoreBaselineModel } from "./baseline-model.mjs";
import { EXECUTION_NET_RETURN, readExecutionCost } from "./execution-costs.mjs";
import { checkFeatureQuality } from "./feature-quality.mjs";
import { appendPaperOrder } from "./paper-orders.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INPUT_KEYS = Object.freeze([
  "actor",
  "decisionId",
  "idempotencyKey",
  "orderId",
  "featureVersion",
  "prediction",
  "quality",
  "limits",
  "notional",
  "fees",
  "killSwitch",
]);
const READ_KEYS = Object.freeze(["actor", "decisionId"]);
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const PREDICTION_KEYS = Object.freeze(["version", "features"]);
const QUALITY_KEYS = Object.freeze(["asOf", "receiveTime", "lagThreshold", "features"]);
const LIMIT_KEYS = Object.freeze(["maxNotional"]);
const FEE_KEYS = Object.freeze(["bids", "asks", "quantity", "feeRate"]);

export const PAPER_DECISION_LIMITATIONS = Object.freeze([
  "expected move is NOT IN SOURCE",
  "no-trade band is NOT IN SOURCE",
  "safety buffer is NOT IN SOURCE",
  "other limit rules are NOT IN SOURCE",
]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    idempotentReplay: false,
    orderCreated: false,
    audit: null,
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

function parseDecimal(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return { n: BigInt(digits), scale: frac.length };
}

function compare(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const a = left.n * 10n ** BigInt(scale - left.scale);
  const b = right.n * 10n ** BigInt(scale - right.scale);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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

function actorOf(actor) {
  if (!plainObject(actor) || unknownKey(actor, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  const id = named(actor.id, "role scope denied");
  if (!id.ok) return id;
  const tenantId = named(actor.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (actor.role !== "Admin") return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function decisionKey(tenantId, decisionId) {
  return `${tenantId}\u0000${decisionId}`;
}

function requestKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function storesOf(stores) {
  return plainObject(stores)
    && unknownKey(stores, ["baseline", "orders", "decisions"]) === false
    && plainObject(stores.baseline)
    && stores.baseline.kind === "baseline"
    && stores.baseline.versions instanceof Map
    && plainObject(stores.orders)
    && stores.orders.orders instanceof Map
    && stores.orders.keys instanceof Map
    && plainObject(stores.decisions)
    && stores.decisions.decisions instanceof Map
    && stores.decisions.keys instanceof Map
    && Array.isArray(stores.decisions.audits);
}

function canonical(input, actorId) {
  return JSON.stringify({
    actorId,
    decisionId: input.decisionId,
    featureVersion: input.featureVersion,
    version: input.prediction.version,
    features: input.prediction.features,
    asOf: input.quality.asOf,
    receiveTime: input.quality.receiveTime,
    lagThreshold: input.quality.lagThreshold,
    qualityFeatures: input.quality.features,
    maxNotional: input.limits.maxNotional,
    notional: input.notional,
    bids: input.fees.bids,
    asks: input.fees.asks,
    quantity: input.fees.quantity,
    feeRate: input.fees.feeRate,
    killSwitch: input.killSwitch,
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
  });
}

function outcome(audit, replay) {
  const created = audit.orderCreated === true;
  return deepFreeze({
    ok: created,
    blocked: created ? null : "BLOCKED",
    error: audit.error,
    idempotentReplay: replay,
    orderCreated: created,
    audit,
  });
}

function blankAudit(fields) {
  return {
    decisionId: fields.decisionId,
    idempotencyKey: fields.idempotencyKey,
    orderId: fields.orderId,
    actorId: fields.actorId,
    tenantId: fields.tenantId,
    modelVersion: null,
    formula: null,
    featureVersion: fields.featureVersion,
    score: null,
    calibratedProbability: null,
    dataApproved: false,
    riskApproved: false,
    killSwitch: null,
    notional: null,
    maxNotional: null,
    feeRate: null,
    netReturn: null,
    feeFormula: null,
    qualityCheck: null,
    qualityFeature: null,
    qualitySource: null,
    orderCreated: false,
    liveTrading: "OFF",
    liveOrdersLocked: true,
    liveOrderSubmitted: false,
    venueClient: null,
    mode: "paper",
    product: "spot",
    limitations: PAPER_DECISION_LIMITATIONS,
    error: fields.error,
    sequence: fields.sequence,
  };
}

export function createPaperDecisionStore() {
  return { decisions: new Map(), keys: new Map(), audits: Object.freeze([]) };
}

export function decidePaperOrder(stores, input) {
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
  const featureVersion = named(input.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return fail(featureVersion.error);
  if (!plainObject(input.prediction) || unknownKey(input.prediction, PREDICTION_KEYS)) return fail("unsupported field");
  if (!plainObject(input.quality) || unknownKey(input.quality, QUALITY_KEYS)) return fail("unsupported field");
  if (!plainObject(input.limits) || unknownKey(input.limits, LIMIT_KEYS)) return fail("unsupported field");
  if (!plainObject(input.fees) || unknownKey(input.fees, FEE_KEYS)) return fail("unsupported field");
  if (typeof input.killSwitch !== "boolean") return fail("kill switch is not configured");
  const notional = decimalField(input.notional, "notional is not configured");
  if (!notional.ok) return fail(notional.error);
  const maxNotional = decimalField(input.limits.maxNotional, "max notional is not configured");
  if (!maxNotional.ok) return fail(maxNotional.error);
  const feeRate = decimalField(input.fees.feeRate, "fee is not configured");
  if (!feeRate.ok) return fail(feeRate.error);

  const body = canonical({
    ...input,
    decisionId: decisionId.value,
    idempotencyKey: idempotencyKey.value,
    orderId: orderId.value,
    featureVersion: featureVersion.value,
  }, actor.actor.id);
  const stored = stores.decisions.keys.get(requestKey(actor.actor.tenantId, idempotencyKey.value));
  if (stored) {
    if (stored.canonical !== body) return fail("decision is already recorded");
    return outcome(stored.audit, true);
  }
  if (stores.decisions.decisions.has(decisionKey(actor.actor.tenantId, decisionId.value))) {
    return fail("decision is already recorded");
  }

  const scored = scoreBaselineModel(stores.baseline, {
    version: input.prediction.version,
    features: input.prediction.features,
  });
  const quality = checkFeatureQuality({
    asOf: input.quality.asOf,
    receiveTime: input.quality.receiveTime,
    lagThreshold: input.quality.lagThreshold,
    features: input.quality.features,
  });
  const cost = readExecutionCost({
    bids: input.fees.bids,
    asks: input.fees.asks,
    quantity: input.fees.quantity,
    feeRate: feeRate.value,
  });
  const notionalOk = compare(notional.parsed, maxNotional.parsed) <= 0;
  const dataApproved = scored.ok === true && quality.ok === true;
  const riskApproved = input.killSwitch === false && notionalOk && cost.ok === true;
  let error = null;
  if (!scored.ok) error = scored.error;
  else if (!quality.ok) error = quality.error;
  else if (input.killSwitch) error = "kill switch is on";
  else if (!notionalOk) error = "notional cap is exceeded";
  else if (!cost.ok) error = cost.error;

  let orderCreated = dataApproved && riskApproved;
  if (orderCreated) {
    const appended = appendPaperOrder(stores.orders, {
      actor: actor.actor,
      orderId: orderId.value,
      idempotencyKey: idempotencyKey.value,
      state: "create",
      product: "spot",
    });
    if (!appended.ok) {
      orderCreated = false;
      error = appended.error;
    }
  }

  const audit = deepFreeze({
    ...blankAudit({
      decisionId: decisionId.value,
      idempotencyKey: idempotencyKey.value,
      orderId: orderId.value,
      actorId: actor.actor.id,
      tenantId: actor.actor.tenantId,
      featureVersion: featureVersion.value,
      error: orderCreated ? null : error,
      sequence: String(stores.decisions.audits.length + 1),
    }),
    modelVersion: scored.modelVersion,
    formula: scored.formula,
    score: scored.ok ? scored.score : null,
    dataApproved,
    riskApproved,
    killSwitch: input.killSwitch,
    notional: notional.value,
    maxNotional: maxNotional.value,
    feeRate: feeRate.value,
    netReturn: cost.ok ? cost.netReturn : null,
    feeFormula: cost.ok ? EXECUTION_NET_RETURN : null,
    qualityCheck: quality.ok ? null : quality.check,
    qualityFeature: quality.ok ? null : quality.feature,
    qualitySource: quality.ok ? null : quality.source,
    orderCreated,
  });
  const audits = Object.freeze([...stores.decisions.audits, audit]);
  stores.decisions.audits = audits;
  stores.decisions.decisions.set(decisionKey(actor.actor.tenantId, decisionId.value), audit);
  stores.decisions.keys.set(requestKey(actor.actor.tenantId, idempotencyKey.value), {
    canonical: body,
    audit,
  });
  return outcome(audit, false);
}

export function readPaperDecision(store, input) {
  if (!plainObject(store) || !(store.decisions instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const decisionId = named(input.decisionId, "decision is not configured");
  if (!decisionId.ok) return fail(decisionId.error);
  const audit = store.decisions.get(decisionKey(actor.actor.tenantId, decisionId.value));
  if (!audit || audit.tenantId !== actor.actor.tenantId) return fail("decision is not configured");
  return outcome(audit, false);
}
