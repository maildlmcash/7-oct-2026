// Commission plan basis and caps for TASK 17.B.01.
// Design section 12 names the plan fields and says a child cannot exceed a
// parent commission ceiling. Rates are caller-supplied basis points. The only
// numeric bound is the design pool: parent share plus child share plus
// platform share cannot exceed the whole eligible pool, which is 10000 basis
// points. This module does not hard-code a commission rate, calculate an
// accrual, or append a ledger entry.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const APPROVER_KEYS = Object.freeze(["id", "role"]);
const DEFINE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "planId",
  "product",
  "action",
  "eligibleRole",
  "basis",
  "rate",
  "rateCap",
  "parentShare",
  "childShare",
  "platformShare",
  "effectiveFrom",
  "effectiveTo",
  "currency",
  "hold",
  "refund",
  "reversal",
  "requiredApprovers",
  "changedAt",
  "permission",
  "ownerId",
]);
const APPROVE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "planId",
  "changedAt",
  "permission",
  "ownerId",
]);
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
const PRODUCTS = new Set(["admin", "distributor", "retailer", "customer", "white-label", "api"]);
const CHILD_PRODUCTS = new Set(["distributor", "retailer", "customer"]);
const APPROVED_BASES = new Set([
  "per request",
  "subscription",
  "spread share",
  "realized performance fee",
  "realized net positive pnl",
  "billable api units",
  "attributed settled performance share",
  "negotiated enterprise fee",
]);
const FORBIDDEN_ACTIONS = new Set([
  "unrealized",
  "deposits",
  "notional",
  "notional volume",
  "paper profit",
  "paper pnl",
  "gross paper pnl",
  "unverified signal",
]);
const ENTRY_KINDS = new Set(["reversed", "adjusted"]);
const ELIGIBLE = Object.freeze({
  admin: Object.freeze(["Admin"]),
  distributor: Object.freeze(["Distributor"]),
  retailer: Object.freeze(["Retailer"]),
  customer: Object.freeze(["Customer"]),
  "white-label": Object.freeze(["Admin", "Distributor", "Retailer"]),
  api: Object.freeze(["Admin", "Distributor", "Retailer"]),
});

// Design section 12: the shares of one pool cannot exceed the whole pool.
// Basis points make that bound 10000. It is not a commission rate.
const POOL_BASIS_POINTS = 10000n;

export const COMMISSION_PLAN_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "rates are caller-supplied basis points",
  "the pool bound is 10000 basis points and is not a commission rate",
  "customer downstream commission is supplied zero or it is rejected",
  "a missing rate is not filled with zero",
  "commission amounts are not calculated",
  "ledger entries are not written",
  "Super Distributor commission is NOT IN SOURCE",
  "API partner is not a catalog role",
  "hold duration is NOT IN SOURCE",
  "shell authorization is unchanged",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    planCount: fields.planCount ?? 0,
    approvalCount: fields.approvalCount ?? 0,
    planStatus: fields.planStatus ?? null,
    idempotentReplay: fields.idempotentReplay === true,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: COMMISSION_PLAN_LIMITATIONS,
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
  return Boolean(store)
    && store.tenants instanceof Map
    && Array.isArray(store.plans)
    && Array.isArray(store.approvals);
}

function counts(store) {
  return {
    planCount: store.plans.length,
    approvalCount: store.approvals.length,
  };
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

function basisPoints(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    return { ok: false, error: "rate is out of range" };
  }
  const canon = value.replace(/^0+(?=\d)/, "");
  const amount = BigInt(canon);
  if (amount > POOL_BASIS_POINTS) return { ok: false, error: "rate is out of range" };
  return { ok: true, text: canon, amount };
}

function editorAllowed(actor, product) {
  if (actor.role === "Super Admin") return true;
  return actor.role === "Admin" && CHILD_PRODUCTS.has(product);
}

function ancestorsOf(store, tenantId) {
  const found = [];
  let current = store.tenants.get(tenantId);
  const seen = new Set();
  while (current && current.parentId) {
    if (seen.has(current.parentId)) break;
    seen.add(current.parentId);
    found.push(current.parentId);
    current = store.tenants.get(current.parentId);
  }
  return found;
}

function covers(plan, effectiveFrom) {
  return plan.effectiveFrom <= effectiveFrom && effectiveFrom < plan.effectiveTo;
}

function parentCeiling(store, tenantId, product, action, eligibleRole, effectiveFrom) {
  for (const ancestor of ancestorsOf(store, tenantId)) {
    const plan = store.plans.find((row) => (
      row.status === "approved"
      && row.tenantId === ancestor
      && row.product === product
      && row.action === action
      && row.eligibleRole === eligibleRole
      && covers(row, effectiveFrom)
    ));
    if (plan) return plan;
  }
  return null;
}

function overlaps(left, right) {
  return left.effectiveFrom < right.effectiveTo && right.effectiveFrom < left.effectiveTo;
}

function sameVersion(row, plan) {
  return row.planId === plan.planId
    && row.tenantId === plan.tenantId
    && row.changedAt === plan.changedAt
    && row.product === plan.product
    && row.action === plan.action
    && row.eligibleRole === plan.eligibleRole
    && row.basis === plan.basis
    && row.rate === plan.rate
    && row.rateCap === plan.rateCap
    && row.parentShare === plan.parentShare
    && row.childShare === plan.childShare
    && row.platformShare === plan.platformShare
    && row.effectiveFrom === plan.effectiveFrom
    && row.effectiveTo === plan.effectiveTo
    && row.currency === plan.currency
    && row.hold === plan.hold
    && row.refund === plan.refund
    && row.reversal === plan.reversal
    && row.makerId === plan.makerId
    && row.requiredApprovers.length === plan.requiredApprovers.length
    && row.requiredApprovers.every((approver, index) => (
      approver.id === plan.requiredApprovers[index].id
      && approver.role === plan.requiredApprovers[index].role
    ));
}

function approverList(value, makerId) {
  if (value === undefined || value === null) return { ok: false, error: "approver is not configured" };
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "approver is not configured" };
  const approvers = [];
  const seen = new Set();
  for (const entry of value) {
    if (!plainObject(entry) || unknownKey(entry, APPROVER_KEYS)) {
      return { ok: false, error: "unsupported field" };
    }
    const id = named(entry.id, "approver is not configured");
    if (!id.ok) return id;
    if (!isKnownRole(entry.role) || entry.role !== "Super Admin") {
      return { ok: false, error: "role scope denied" };
    }
    if (id.value === makerId) return { ok: false, error: "maker cannot approve" };
    if (seen.has(id.value)) return { ok: false, error: "approvers are not distinct" };
    seen.add(id.value);
    approvers.push(Object.freeze({ id: id.value, role: entry.role }));
  }
  return { ok: true, approvers };
}

export function createCommissionStore() {
  return {
    tenants: new Map(),
    assignments: [],
    capabilities: [],
    plans: [],
    approvals: [],
  };
}

export function defineCommissionPlan(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, DEFINE_KEYS)) return fail("unsupported field", counts(store));
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const product = named(input.product, "product is not supported");
  if (!product.ok) return fail(product.error, counts(store));
  if (!PRODUCTS.has(product.value)) return fail("product is not supported", counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  if (!editorAllowed(actor.actor, product.value)) return fail("role scope denied", counts(store));
  const planId = named(input.planId, "plan is not recorded");
  if (!planId.ok) return fail(planId.error, counts(store));
  const action = named(input.action, "action is not approved");
  if (!action.ok) return fail(action.error, counts(store));
  if (FORBIDDEN_ACTIONS.has(action.value.toLowerCase())) return fail("action is not approved", counts(store));
  const eligibleRole = named(input.eligibleRole, "role is not eligible");
  if (!eligibleRole.ok) return fail(eligibleRole.error, counts(store));
  const allowedRoles = ELIGIBLE[product.value] ?? [];
  if (!allowedRoles.includes(eligibleRole.value)) return fail("role is not eligible", counts(store));
  const basis = named(input.basis, "basis is not approved");
  if (!basis.ok) return fail(basis.error, counts(store));
  if (!APPROVED_BASES.has(basis.value)) return fail("basis is not approved", counts(store));
  const rate = basisPoints(input.rate, "rate is not configured");
  if (!rate.ok) return fail(rate.error, counts(store));
  const rateCap = basisPoints(input.rateCap, "rate cap is not configured");
  if (!rateCap.ok) return fail(rateCap.error, counts(store));
  const parentShare = basisPoints(input.parentShare, "allocation is not configured");
  if (!parentShare.ok) return fail(parentShare.error, counts(store));
  const childShare = basisPoints(input.childShare, "allocation is not configured");
  if (!childShare.ok) return fail(childShare.error, counts(store));
  const platformShare = basisPoints(input.platformShare, "allocation is not configured");
  if (!platformShare.ok) return fail(platformShare.error, counts(store));
  if (product.value === "customer" && (rate.amount !== 0n || rateCap.amount !== 0n || childShare.amount !== 0n)) {
    return fail("customer commission is not allowed", counts(store));
  }
  if (rate.amount > rateCap.amount) return fail("rate exceeds cap", counts(store));
  if (parentShare.amount + childShare.amount + platformShare.amount > POOL_BASIS_POINTS) {
    return fail("allocation exceeds pool", counts(store));
  }
  const changedAt = stamp(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error === "changedAt is required" ? changedAt.error : "unsupported field", counts(store));
  const effectiveFrom = stamp(input.effectiveFrom, "effective time is not configured");
  if (!effectiveFrom.ok) return fail(effectiveFrom.error, counts(store));
  const effectiveTo = stamp(input.effectiveTo, "effective time is not configured");
  if (!effectiveTo.ok) return fail(effectiveTo.error, counts(store));
  if (effectiveFrom.value >= effectiveTo.value) return fail("period is not valid", counts(store));
  if (effectiveFrom.value < changedAt.value) return fail("rate change is retroactive", counts(store));
  const currency = named(input.currency, "currency is not configured");
  if (!currency.ok) return fail(currency.error, counts(store));
  if (typeof input.hold !== "boolean") return fail("hold is not configured", counts(store));
  if (!ENTRY_KINDS.has(input.refund)) return fail("refund is not configured", counts(store));
  if (!ENTRY_KINDS.has(input.reversal)) return fail("reversal is not configured", counts(store));
  const approvers = approverList(input.requiredApprovers, actor.actor.id);
  if (!approvers.ok) return fail(approvers.error, counts(store));
  const ceiling = parentCeiling(
    store,
    tenantId.value,
    product.value,
    action.value,
    eligibleRole.value,
    effectiveFrom.value,
  );
  if (actor.actor.role !== "Super Admin" && !ceiling) return fail("ceiling is not configured", counts(store));
  if (ceiling && rateCap.amount > BigInt(ceiling.rateCap)) {
    return fail("child exceeds parent ceiling", counts(store));
  }
  const plan = {
    planId: planId.value,
    tenantId: tenantId.value,
    product: product.value,
    action: action.value,
    eligibleRole: eligibleRole.value,
    basis: basis.value,
    rate: rate.text,
    rateCap: rateCap.text,
    parentShare: parentShare.text,
    childShare: childShare.text,
    platformShare: platformShare.text,
    effectiveFrom: effectiveFrom.value,
    effectiveTo: effectiveTo.value,
    currency: currency.value,
    hold: input.hold,
    refund: input.refund,
    reversal: input.reversal,
    makerId: actor.actor.id,
    changedAt: changedAt.value,
    requiredApprovers: approvers.approvers,
  };
  const prior = store.plans.find((row) => (
    row.planId === plan.planId && row.tenantId === plan.tenantId && row.changedAt === plan.changedAt
  ));
  if (prior) {
    if (sameVersion(prior, plan)) {
      return view({ ok: true, idempotentReplay: true, planStatus: prior.status, ...counts(store) });
    }
    return fail("plan is already recorded", counts(store));
  }
  const clash = store.plans.find((row) => (
    row.tenantId === plan.tenantId
    && row.product === plan.product
    && row.action === plan.action
    && row.eligibleRole === plan.eligibleRole
    && overlaps(row, plan)
  ));
  if (clash) return fail("period overlaps an active plan", counts(store));
  store.plans.push(Object.freeze({
    ...plan,
    requiredApprovers: Object.freeze(plan.requiredApprovers),
    status: "pending",
  }));
  return view({ ok: true, planStatus: "pending", ...counts(store) });
}

function refreshStatus(store, plan) {
  const approved = plan.requiredApprovers.every((approver) => store.approvals.some((row) => (
    row.planId === plan.planId
    && row.tenantId === plan.tenantId
    && row.changedAt === plan.changedAt
    && row.approverId === approver.id
  )));
  const status = approved ? "approved" : "pending";
  if (plan.status === status) return plan;
  const index = store.plans.indexOf(plan);
  const next = Object.freeze({ ...plan, status });
  if (index >= 0) store.plans[index] = next;
  return next;
}

export function approveCommissionPlan(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field", counts(store));
  const secret = problemIn(input);
  if (secret) return fail(secret, counts(store));
  if (unknownKey(input, APPROVE_KEYS)) return fail("unsupported field", counts(store));
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error, counts(store));
  const permission = permissionProblem(actor.actor, input.permission);
  if (permission) return fail(permission, counts(store));
  const owner = ownerProblem(actor.actor, input.ownerId);
  if (owner) return fail(owner, counts(store));
  if (actor.actor.role !== "Super Admin") return fail("role scope denied", counts(store));
  const tenantId = named(input.tenantId, "tenant is not configured");
  if (!tenantId.ok) return fail(tenantId.error, counts(store));
  const planId = named(input.planId, "plan is not recorded");
  if (!planId.ok) return fail(planId.error, counts(store));
  const changedAt = stamp(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error === "changedAt is required" ? changedAt.error : "unsupported field", counts(store));
  const scope = tenantInScope(store, actor.actor, tenantId.value);
  if (scope) return fail(scope, counts(store));
  const plan = store.plans.find((row) => (
    row.planId === planId.value && row.tenantId === tenantId.value && row.changedAt === changedAt.value
  ));
  if (!plan) return fail("plan is not recorded", counts(store));
  if (plan.makerId === actor.actor.id) return fail("maker cannot approve", counts(store));
  const required = plan.requiredApprovers.find((approver) => approver.id === actor.actor.id);
  if (!required || required.role !== actor.actor.role) return fail("approver is not recorded", counts(store));
  const existing = store.approvals.find((row) => (
    row.planId === plan.planId
    && row.tenantId === plan.tenantId
    && row.changedAt === plan.changedAt
    && row.approverId === actor.actor.id
  ));
  if (existing) {
    return view({ ok: true, idempotentReplay: true, planStatus: plan.status, ...counts(store) });
  }
  store.approvals.push(Object.freeze({
    planId: plan.planId,
    tenantId: plan.tenantId,
    changedAt: plan.changedAt,
    approverId: actor.actor.id,
    approverRole: actor.actor.role,
  }));
  const next = refreshStatus(store, plan);
  return view({ ok: true, planStatus: next.status, ...counts(store) });
}
