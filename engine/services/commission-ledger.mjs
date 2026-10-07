// Append-only commission ledger for TASK 17.C.01.
// Each earning, hold, release, refund, and reversal is a new frozen entry.
// The amount and plan snapshot come from calculateCommission. A second post
// for the same idempotency key or the same event and plan version does not
// append another payment. A refund or reversal appends a compensating entry
// and leaves the original entry in place. Hold duration, rounding mode,
// statement totals, and role visibility are not in this module.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";
import { calculateCommission } from "./commission-calculation.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const CALC_FIELDS = Object.freeze([
  "actor",
  "tenantId",
  "product",
  "action",
  "eligibleRole",
  "eventId",
  "occurredAt",
  "fee",
  "refund",
  "exclusions",
  "currency",
  "orderStatus",
  "customerId",
  "beneficiaryId",
  "rounding",
  "permission",
  "ownerId",
  "notional",
  "unrealizedPnl",
  "paperPnl",
  "deposits",
  "pnl",
]);
const POST_KEYS = Object.freeze([
  ...CALC_FIELDS,
  "kind",
  "idempotencyKey",
  "amount",
  "reason",
  "referenceKey",
]);
const KINDS = new Set(["earning", "hold", "release", "refund", "reversal"]);
const REASONS = new Set(["reversed", "adjusted"]);
const FORBIDDEN_BASES = new Set(["notional", "unrealizedPnl", "paperPnl", "deposits", "pnl"]);
const CREDENTIAL_KEYS = new Set([
  "apiKey",
  "apiSecret",
  "secret",
  "privateKey",
  "seedPhrase",
  "token",
  "password",
  "credential",
]);

export const COMMISSION_LEDGER_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "entries are append-only",
  "a duplicate event is not paid twice",
  "a correction preserves the original entry",
  "hold duration is NOT IN SOURCE",
  "rounding mode is NOT IN SOURCE",
  "a remainder is not rounded",
  "commission reports are not this module",
  "statement totals are not this module",
  "role visibility is not this module",
  "Super Distributor commission is NOT IN SOURCE",
  "a separate calculation version label is NOT IN SOURCE",
]);

function view(store, fields) {
  const entries = Array.isArray(store?.entries) ? store.entries.length : 0;
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    idempotentReplay: fields.idempotentReplay === true,
    entryCount: entries,
    entries: fields.entries ?? null,
    kind: fields.kind ?? null,
    eventId: fields.eventId ?? null,
    planId: fields.planId ?? null,
    changedAt: fields.changedAt ?? null,
    amount: fields.amount ?? null,
    netFee: fields.netFee ?? null,
    cumulativeAmount: fields.cumulativeAmount ?? null,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: COMMISSION_LEDGER_LIMITATIONS,
  });
}

function fail(store, error, extra = {}) {
  return view(store, { ok: false, error, ...extra });
}

function succeed(store, rows, idempotentReplay) {
  const first = rows[0];
  return view(store, {
    ok: true,
    idempotentReplay,
    entries: Object.freeze(rows.slice()),
    kind: first.kind,
    eventId: first.eventId,
    planId: first.planId,
    changedAt: first.changedAt,
    amount: first.amount,
    netFee: first.netFee,
    cumulativeAmount: first.cumulativeAmount,
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

function problemIn(value, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    return leaked(value) ? "secret value is not allowed" : null;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = problemIn(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (leaked(key) || CREDENTIAL_KEYS.has(key)) {
      return leaked(key) || leaked(value[key]) ? "secret value is not allowed" : "live credentials are not allowed";
    }
    const found = problemIn(value[key], seen);
    if (found) return found;
  }
  return null;
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
  if (!isKnownRole(actor.role)) return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function validStore(store) {
  return Boolean(store) && store.tenants instanceof Map && Array.isArray(store.plans);
}

function permissionProblem(actor, permission) {
  if (permission === undefined) return null;
  if (typeof permission !== "string") return "unsupported field";
  const grants = catalogGrants(actor.role);
  if (!grants || !grants.includes(permission)) return "permission is not granted";
  return null;
}

function ownerProblem(actor, ownerId) {
  if (ownerId === undefined) return null;
  const owner = named(ownerId, "resource owner is outside scope");
  if (!owner.ok) return owner.error === "unsupported field" ? "unsupported field" : "resource owner is outside scope";
  if (owner.value !== actor.id) return "resource owner is outside scope";
  return null;
}

function tenantInScope(store, actor, tenantId) {
  if (!store.tenants.has(tenantId)) return "tenant is not configured";
  if (actor.role === "Super Admin") return null;
  if (!store.tenants.has(actor.tenantId)) return "tenant is not configured";
  let current = tenantId;
  const seen = new Set();
  while (current) {
    if (seen.has(current)) return "tenant is outside subtree";
    seen.add(current);
    if (current === actor.tenantId) return null;
    const row = store.tenants.get(current);
    current = row ? row.parentId : null;
  }
  return "tenant is outside subtree";
}

function gate(store, input) {
  const actor = actorOf(input.actor);
  if (!actor.ok) return actor;
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return { ok: false, error: permission };
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return { ok: false, error: owner };
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return tenantId;
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return { ok: false, error: scope };
  if (actor.actor.role !== "Super Admin" && actor.actor.role !== "Admin") {
    return { ok: false, error: "role scope denied" };
  }
  return { ok: true };
}

function calculationInput(input) {
  const body = {};
  for (const key of CALC_FIELDS) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  return body;
}

function lineageOf(lines) {
  return Object.freeze(lines.map((line) => Object.freeze({
    tenantId: line.tenantId,
    planId: line.planId,
    changedAt: line.changedAt,
    rate: line.rate,
    amount: line.amount,
  })));
}

function holdsOf(store, lines) {
  const flags = [];
  for (const line of lines) {
    const plan = store.plans.find((row) => (
      row.status === "approved"
      && row.planId === line.planId
      && row.changedAt === line.changedAt
      && row.tenantId === line.tenantId
    ));
    if (!plan || typeof plan.hold !== "boolean") return { ok: false, error: "plan is not in effect" };
    flags.push(plan.hold);
  }
  if (flags.some((flag) => flag !== flags[0])) return { ok: false, error: "hold is not configured" };
  return { ok: true, planHold: flags[0] };
}

function entryFromLine(input, kind, key, line, calculated, planHold, lineage) {
  return Object.freeze({
    idempotencyKey: key,
    kind,
    eventId: calculated.eventId,
    eventTenantId: input.tenantId,
    tenantId: line.tenantId,
    planId: line.planId,
    changedAt: line.changedAt,
    rate: line.rate,
    rateCap: line.rateCap,
    basis: line.basis,
    currency: line.currency,
    product: line.product,
    action: line.action,
    eligibleRole: line.eligibleRole,
    effectiveFrom: line.effectiveFrom,
    effectiveTo: line.effectiveTo,
    amount: line.amount,
    netFee: calculated.netFee,
    cumulativeAmount: calculated.cumulativeAmount,
    cumulativeRate: calculated.cumulativeRate,
    ancestorCap: calculated.ancestorCap,
    capAmount: calculated.capAmount,
    beneficiaryId: input.beneficiaryId,
    customerId: input.customerId,
    planHold,
    referenceKey: null,
    reason: null,
    lineage,
  });
}

function compensate(original, kind, key, reason) {
  return Object.freeze({
    idempotencyKey: key,
    kind,
    eventId: original.eventId,
    eventTenantId: original.eventTenantId,
    tenantId: original.tenantId,
    planId: original.planId,
    changedAt: original.changedAt,
    rate: original.rate,
    rateCap: original.rateCap,
    basis: original.basis,
    currency: original.currency,
    product: original.product,
    action: original.action,
    eligibleRole: original.eligibleRole,
    effectiveFrom: original.effectiveFrom,
    effectiveTo: original.effectiveTo,
    amount: original.amount,
    netFee: original.netFee,
    cumulativeAmount: original.cumulativeAmount,
    cumulativeRate: original.cumulativeRate,
    ancestorCap: original.ancestorCap,
    capAmount: original.capAmount,
    beneficiaryId: original.beneficiaryId,
    customerId: original.customerId,
    planHold: original.planHold,
    referenceKey: original.idempotencyKey,
    reason,
    lineage: original.lineage,
  });
}

function marker(row) {
  return [
    row.kind,
    row.eventId,
    row.eventTenantId,
    row.tenantId,
    row.planId,
    row.changedAt,
    row.rate,
    row.amount,
    row.beneficiaryId,
    row.customerId,
    row.currency,
    row.referenceKey ?? "",
    row.reason ?? "",
    row.planHold,
    row.netFee,
    row.cumulativeAmount,
  ].join("\u0000");
}

function samePost(existing, proposed) {
  if (existing.length !== proposed.length) return false;
  for (let index = 0; index < existing.length; index += 1) {
    if (marker(existing[index]) !== marker(proposed[index])) return false;
  }
  return true;
}

function statedProblem(input, rows) {
  if (input.amount === undefined) return null;
  if (typeof input.amount !== "string") return "unsupported field";
  if (rows.some((row) => row.amount !== input.amount)) return "amount does not match";
  return null;
}

function alreadyPaid(store, kind, eventId, line) {
  return store.entries.some((row) => (
    row.kind === kind
    && row.eventId === eventId
    && row.tenantId === line.tenantId
    && row.planId === line.planId
    && row.changedAt === line.changedAt
  ));
}

function commit(store, input, proposed, duplicate) {
  const existing = store.entries.filter((row) => row.idempotencyKey === proposed[0].idempotencyKey);
  const stated = statedProblem(input, proposed);
  if (existing.length > 0) {
    if (!stated && samePost(existing, proposed)) return succeed(store, existing, true);
    return fail(store, "idempotency key is already recorded");
  }
  if (duplicate) return fail(store, "event is already recorded");
  if (stated) return fail(store, stated);
  for (const row of proposed) store.entries.push(row);
  return succeed(store, proposed, false);
}

function postCalculated(store, input, kind, key) {
  const calculated = calculateCommission(store, calculationInput(input));
  if (!calculated.ok) return fail(store, calculated.error, { eventId: calculated.eventId });
  if (!Array.isArray(calculated.lines) || calculated.lines.length === 0) {
    return fail(store, "plan is not in effect");
  }
  const holds = holdsOf(store, calculated.lines);
  if (!holds.ok) return fail(store, holds.error);
  if (kind === "earning" && holds.planHold === true) return fail(store, "hold is required");
  if (kind === "hold" && holds.planHold === false) return fail(store, "hold is not configured");
  const lineage = lineageOf(calculated.lines);
  const proposed = calculated.lines.map((line) => (
    entryFromLine(input, kind, key, line, calculated, holds.planHold, lineage)
  ));
  const duplicate = proposed.some((line) => alreadyPaid(store, kind, calculated.eventId, line));
  return commit(store, input, proposed, duplicate);
}

function reasonOf(input, required) {
  if (input.reason === undefined) {
    return required ? { ok: false, error: "reason is not configured" } : { ok: true, value: null };
  }
  if (!REASONS.has(input.reason)) return { ok: false, error: "reason is not configured" };
  return { ok: true, value: input.reason };
}

function orderProblem(input) {
  if (input.orderStatus === undefined) return null;
  if (typeof input.orderStatus !== "string") return "unsupported field";
  if (input.orderStatus === "rejected" || input.orderStatus === "cancelled") return "order is excluded";
  if (input.orderStatus !== "settled") return "order is not settled";
  return null;
}

function sameEvent(input, row) {
  return row.eventId === input.eventId
    && row.eventTenantId === input.tenantId
    && row.beneficiaryId === input.beneficiaryId
    && row.customerId === input.customerId
    && row.currency === input.currency;
}

function postCorrection(store, input, kind, key) {
  const allowed = gate(store, input);
  if (!allowed.ok) return fail(store, allowed.error);
  for (const basis of FORBIDDEN_BASES) {
    if (input[basis] !== undefined) return fail(store, "basis is not approved");
  }
  const order = orderProblem(input);
  if (order) return fail(store, order);
  if (input.rounding !== undefined) return fail(store, "rounding is not configured");
  const customerId = named(input.customerId, "self-referral is not configured");
  if (!customerId.ok) return fail(store, customerId.error);
  const beneficiaryId = named(input.beneficiaryId, "self-referral is not configured");
  if (!beneficiaryId.ok) return fail(store, beneficiaryId.error);
  if (customerId.value === beneficiaryId.value) return fail(store, "self-referral is not allowed");
  const currency = named(input.currency, "currency is not configured");
  if (!currency.ok) return fail(store, currency.error);
  const eventId = named(input.eventId, "event is not configured");
  if (!eventId.ok) return fail(store, eventId.error);
  const referenceKey = named(input.referenceKey, "reference is not configured");
  if (!referenceKey.ok) return fail(store, referenceKey.error);
  const reason = reasonOf(input, kind === "refund" || kind === "reversal");
  if (!reason.ok) return fail(store, reason.error);
  const wanted = kind === "release" ? new Set(["hold"]) : new Set(["earning", "hold"]);
  const originals = store.entries.filter((row) => (
    row.idempotencyKey === referenceKey.value && wanted.has(row.kind)
  ));
  if (originals.length === 0) {
    return fail(store, kind === "release" ? "hold is not recorded" : "entry is not recorded");
  }
  if (originals.some((row) => !sameEvent(input, row))) return fail(store, "entry is not recorded");
  if (kind === "release" && originals.some((row) => row.planHold !== true)) {
    return fail(store, "hold is not recorded");
  }
  const proposed = originals.map((row) => compensate(row, kind, key, reason.value));
  const duplicate = kind === "release"
    ? store.entries.some((row) => row.kind === "release" && row.referenceKey === referenceKey.value)
    : store.entries.some((row) => (
      (row.kind === "refund" || row.kind === "reversal") && row.referenceKey === referenceKey.value
    ));
  return commit(store, input, proposed, duplicate);
}

export function appendLedgerEntry(store, input) {
  if (!validStore(store)) return fail(store, "unsupported field");
  if (!Array.isArray(store.entries)) return fail(store, "ledger is not configured");
  if (!plainObject(input)) return fail(store, "unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(store, secret);
  if (unknownKey(input, POST_KEYS)) return fail(store, "unsupported field");
  const kind = named(input.kind, "entry kind is not configured");
  if (!kind.ok) return fail(store, kind.error);
  if (!KINDS.has(kind.value)) return fail(store, "entry kind is not approved");
  const idempotencyKey = named(input.idempotencyKey, "idempotency key is not configured");
  if (!idempotencyKey.ok) return fail(store, idempotencyKey.error);
  if (kind.value === "earning" || kind.value === "hold") {
    return postCalculated(store, input, kind.value, idempotencyKey.value);
  }
  return postCorrection(store, input, kind.value, idempotencyKey.value);
}
