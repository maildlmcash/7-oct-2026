// Commission calculation for TASK 17.B.02.
// The amount is the approved plan's snapshotted basis-point rate applied to
// the event net fee. Net fee is fee minus refund minus exclusions. Notional,
// unrealized PnL, deposits, and paper profit are not a basis. Division by
// 10000 stays exact in scaled integers. The source names no rounding mode,
// so a caller rounding instruction is refused. The sum of lineage rates
// cannot exceed the tightest ancestor rate cap. This module does not append
// a ledger entry.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const CALC_KEYS = Object.freeze([
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
const POOL_SCALE = 4;

export const COMMISSION_CALCULATION_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "the numeric basis is the net fee",
  "notional is not a commission basis",
  "unrealized pnl is not a commission basis",
  "paper profit is not a commission basis",
  "a remainder is not rounded",
  "rounding mode is NOT IN SOURCE",
  "duplicate event suppression is not this module",
  "ledger entries are not written",
  "commission reports are not this module",
  "hold duration is NOT IN SOURCE",
  "Super Distributor commission is NOT IN SOURCE",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    netFee: fields.netFee ?? null,
    amount: fields.amount ?? null,
    cumulativeAmount: fields.cumulativeAmount ?? null,
    cumulativeRate: fields.cumulativeRate ?? null,
    ancestorCap: fields.ancestorCap ?? null,
    capAmount: fields.capAmount ?? null,
    lines: fields.lines ?? null,
    snapshot: fields.snapshot ?? null,
    eventId: fields.eventId ?? null,
    idempotentReplay: false,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: COMMISSION_CALCULATION_LIMITATIONS,
  });
}

function fail(error, extra = {}) {
  return view({ ok: false, error, ...extra });
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

function stamp(value, missing) {
  const namedStamp = named(value, missing);
  if (!namedStamp.ok) return namedStamp;
  if (!STAMP.test(namedStamp.value)) return { ok: false, error: missing };
  return namedStamp;
}

function parseDecimal(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (typeof value !== "string" || !DECIMAL.test(value)) return { ok: false, error: "fee is out of range" };
  const [whole, frac = ""] = value.split(".");
  const canon = `${whole.replace(/^0+(?=\d)/, "")}${frac}`;
  return {
    ok: true,
    part: { n: BigInt(canon === "" ? "0" : canon), scale: frac.length },
  };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function format(n, scale) {
  let digits = n.toString();
  if (scale > 0) {
    if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
    const cut = digits.length - scale;
    const whole = digits.slice(0, cut);
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${whole}.${frac}` : whole;
  }
  return digits === "0" ? "0" : digits;
}

function subtract(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) - scaleTo(right, scale), scale };
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) + scaleTo(right, scale), scale };
}

function applyRate(net, rate) {
  return format(net.n * rate, net.scale + POOL_SCALE);
}

function ancestorsOf(store, tenantId) {
  const found = [];
  let current = store.tenants.get(tenantId);
  const seen = new Set();
  while (current && current.parentId) {
    if (seen.has(current.parentId)) return { ok: false, error: "tenant is outside subtree" };
    seen.add(current.parentId);
    found.push(current.parentId);
    current = store.tenants.get(current.parentId);
  }
  return { ok: true, ancestors: found };
}

function covers(plan, occurredAt) {
  return plan.effectiveFrom <= occurredAt && occurredAt < plan.effectiveTo;
}

function covering(store, tenantId, product, action, eligibleRole, occurredAt) {
  return store.plans.filter((row) => (
    row.status === "approved"
    && row.tenantId === tenantId
    && row.product === product
    && row.action === action
    && row.eligibleRole === eligibleRole
    && covers(row, occurredAt)
  ));
}

function snapshotOf(plan, amount) {
  return Object.freeze({
    tenantId: plan.tenantId,
    planId: plan.planId,
    changedAt: plan.changedAt,
    rate: plan.rate,
    rateCap: plan.rateCap,
    basis: plan.basis,
    currency: plan.currency,
    product: plan.product,
    action: plan.action,
    eligibleRole: plan.eligibleRole,
    effectiveFrom: plan.effectiveFrom,
    effectiveTo: plan.effectiveTo,
    amount,
  });
}

export function calculateCommission(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(secret);
  if (unknownKey(input, CALC_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission);
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner);
  for (const key of FORBIDDEN_BASES) {
    if (input[key] !== undefined) return fail("basis is not approved");
  }
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error);
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope);
  if (actor.actor.role !== "Super Admin" && actor.actor.role !== "Admin") {
    return fail("role scope denied");
  }
  const product = named(input.product, "product is not supported");
  if (!product.ok) return fail(product.error);
  const action = named(input.action, "action is not approved");
  if (!action.ok) return fail(action.error);
  const eligibleRole = named(input.eligibleRole, "role is not eligible");
  if (!eligibleRole.ok) return fail(eligibleRole.error);
  if (!isKnownRole(eligibleRole.value)) return fail("role is not eligible");
  const eventId = named(input.eventId, "event is not configured");
  if (!eventId.ok) return fail(eventId.error);
  const occurredAt = stamp(input.occurredAt, "effective time is not configured");
  if (!occurredAt.ok) return fail(occurredAt.error);
  const orderStatus = named(input.orderStatus, "order status is not configured");
  if (!orderStatus.ok) return fail(orderStatus.error);
  if (orderStatus.value === "rejected" || orderStatus.value === "cancelled") {
    return fail("order is excluded");
  }
  if (orderStatus.value !== "settled") return fail("order is not settled");
  const customerId = named(input.customerId, "self-referral is not configured");
  if (!customerId.ok) return fail(customerId.error);
  const beneficiaryId = named(input.beneficiaryId, "self-referral is not configured");
  if (!beneficiaryId.ok) return fail(beneficiaryId.error);
  if (customerId.value === beneficiaryId.value) return fail("self-referral is not allowed");
  const currency = named(input.currency, "currency is not configured");
  if (!currency.ok) return fail(currency.error);
  const fee = parseDecimal(input.fee, "fee is not configured");
  if (!fee.ok) return fail(fee.error);
  const refund = parseDecimal(input.refund, "refund is not configured");
  if (!refund.ok) return fail(refund.error);
  if (!Array.isArray(input.exclusions)) return fail("exclusion is not configured");
  let excluded = { n: 0n, scale: 0 };
  for (const entry of input.exclusions) {
    const parsed = parseDecimal(entry, "exclusion is not configured");
    if (!parsed.ok) return fail(parsed.error);
    excluded = add(excluded, parsed.part);
  }
  let net = subtract(subtract(fee.part, refund.part), excluded);
  if (net.n < 0n) return fail("net fee is not positive");
  if (input.rounding !== undefined) return fail("rounding is not configured");
  const local = covering(store, tenantId.value, product.value, action.value, eligibleRole.value, occurredAt.value);
  if (local.length > 1) return fail("period overlaps an active plan");
  if (local.length === 0) return fail("plan is not in effect");
  const chain = [local[0]];
  const ancestors = ancestorsOf(store, tenantId.value);
  if (!ancestors.ok) return fail(ancestors.error);
  for (const ancestor of ancestors.ancestors) {
    const rows = covering(store, ancestor, product.value, action.value, eligibleRole.value, occurredAt.value);
    if (rows.length > 1) return fail("period overlaps an active plan");
    if (rows.length === 1) chain.push(rows[0]);
  }
  if (ancestors.ancestors.length > 0 && chain.length < 2) return fail("ceiling is not configured");
  for (const plan of chain) {
    if (plan.currency !== currency.value) return fail("currency does not match");
  }
  let cumulative = 0n;
  let cap = null;
  for (const plan of chain) {
    cumulative += BigInt(plan.rate);
    const planCap = BigInt(plan.rateCap);
    if (cap === null || planCap < cap) cap = planCap;
  }
  const netFee = format(net.n, net.scale);
  if (cumulative > cap) {
    return fail("ancestor cap exceeded", {
      netFee,
      cumulativeRate: cumulative.toString(),
      ancestorCap: cap.toString(),
      eventId: eventId.value,
    });
  }
  const lines = chain.map((plan) => snapshotOf(plan, applyRate(net, BigInt(plan.rate))));
  const eventPlan = lines[0];
  return view({
    ok: true,
    netFee,
    amount: eventPlan.amount,
    cumulativeAmount: applyRate(net, cumulative),
    cumulativeRate: cumulative.toString(),
    ancestorCap: cap.toString(),
    capAmount: applyRate(net, cap),
    lines: Object.freeze(lines),
    snapshot: eventPlan,
    eventId: eventId.value,
  });
}
