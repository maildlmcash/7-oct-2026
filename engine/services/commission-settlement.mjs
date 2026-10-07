// Settlement reports for TASK 17.C.02.
// Totals are read from append-only ledger entries. Earned, pending, settled,
// reversed, and statement stay separate. A reconciliation compares a caller
// statement with those totals and does not edit the ledger. Visibility follows
// the tenant subtree. Business and legal commission policy stays pending until
// formal approval. This module does not pay out and does not apply a policy
// amount.

import { health } from "../apps/web/health.mjs";
import { catalogGrants, isKnownRole } from "../packages/contracts/src/roles.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const READ_KEYS = Object.freeze(["actor", "tenantId", "permission", "ownerId"]);
const RECONCILE_KEYS = Object.freeze([
  ...READ_KEYS,
  "earned",
  "pending",
  "settled",
  "reversed",
  "statement",
]);
const POLICY_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "policyId",
  "changedAt",
  "note",
  "status",
  "permission",
  "ownerId",
]);
const READ_ROLES = new Set(["Super Admin", "Admin", "Distributor", "Retailer", "Customer"]);
const STATEMENT_FIELDS = Object.freeze(["earned", "pending", "settled", "reversed", "statement"]);
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
const ZERO = Object.freeze({ n: 0n, scale: 0 });

export const COMMISSION_SETTLEMENT_LIMITATIONS = Object.freeze([
  "catalog permissions stay empty",
  "the ledger is not edited by this module",
  "payout rails are not this module",
  "a balanced statement is not a payout",
  "formal commission policy approval is not recorded",
  "business and legal commission policy stays pending",
  "hold duration is NOT IN SOURCE",
  "rounding mode is NOT IN SOURCE",
  "a remainder is not rounded",
  "high-water mark is NOT IN SOURCE",
  "Super Distributor commission is NOT IN SOURCE",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    idempotentReplay: fields.idempotentReplay === true,
    reconciled: fields.reconciled ?? null,
    alert: fields.alert ?? null,
    promoted: false,
    earned: fields.earned ?? null,
    pending: fields.pending ?? null,
    settled: fields.settled ?? null,
    reversed: fields.reversed ?? null,
    statement: fields.statement ?? null,
    currency: fields.currency ?? null,
    entryCount: fields.entryCount ?? null,
    entries: fields.entries ?? null,
    approvalTrail: fields.approvalTrail ?? null,
    policyApplied: false,
    policyStatus: fields.policyStatus ?? null,
    policies: fields.policies ?? null,
    stated: fields.stated ?? null,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    limitations: COMMISSION_SETTLEMENT_LIMITATIONS,
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

function validStore(store) {
  return Boolean(store)
    && store.tenants instanceof Map
    && Array.isArray(store.plans)
    && Array.isArray(store.approvals);
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

function scopeSet(store, tenantId) {
  const allowed = new Set();
  for (const id of store.tenants.keys()) {
    let current = id;
    const seen = new Set();
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      if (current === tenantId) {
        allowed.add(id);
        break;
      }
      const row = store.tenants.get(current);
      current = row ? row.parentId : null;
    }
  }
  return allowed;
}

function gate(store, input, roles) {
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
  if (!roles.has(actor.actor.role)) return { ok: false, error: "role scope denied" };
  return { ok: true, actor: actor.actor, tenantId: tenantId.value };
}

function parsePart(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const canon = `${whole.replace(/^0+(?=\d)/, "")}${frac}`;
  return { n: BigInt(canon === "" ? "0" : canon), scale: frac.length };
}

function scaleTo(part, scale) {
  return part.n * 10n ** BigInt(scale - part.scale);
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: scaleTo(left, scale) + scaleTo(right, scale), scale };
}

function samePart(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return scaleTo(left, scale) === scaleTo(right, scale);
}

function format(part) {
  let digits = part.n.toString();
  if (part.scale > 0) {
    if (digits.length <= part.scale) digits = digits.padStart(part.scale + 1, "0");
    const cut = digits.length - part.scale;
    const whole = digits.slice(0, cut);
    const frac = digits.slice(cut).replace(/0+$/, "");
    digits = frac.length > 0 ? `${whole}.${frac}` : whole;
  }
  return digits === "0" ? "0" : digits;
}

function sameAmount(left, right) {
  const a = parsePart(left);
  const b = parsePart(right);
  if (!a || !b) return false;
  return samePart(a, b);
}

function visibleEntries(store, actor, allowed) {
  return store.entries.filter((row) => {
    if (!allowed.has(row.tenantId)) return false;
    if (actor.role === "Customer" && row.customerId !== actor.id) return false;
    return true;
  });
}

function linksBalance(entries) {
  for (const row of entries) {
    if (row.kind !== "release" && row.kind !== "refund" && row.kind !== "reversal") continue;
    const originals = entries.filter((item) => (
      item.idempotencyKey === row.referenceKey
      && item.tenantId === row.tenantId
      && item.planId === row.planId
      && item.changedAt === row.changedAt
      && (row.kind === "release"
        ? item.kind === "hold"
        : item.kind === "earning" || item.kind === "hold")
    ));
    if (originals.length !== 1) return false;
    if (!sameAmount(originals[0].amount, row.amount)) return false;
  }
  return true;
}

function corrected(entries, row) {
  return entries.some((item) => (
    item.referenceKey === row.idempotencyKey
    && (item.kind === "refund" || item.kind === "reversal")
  ));
}

function released(entries, row) {
  return entries.some((item) => item.referenceKey === row.idempotencyKey && item.kind === "release");
}

function accumulate(visible, entries) {
  if (!linksBalance(visible)) return { ok: false, error: "ledger is not balanced" };
  let earned = ZERO;
  let pending = ZERO;
  let settled = ZERO;
  let reversed = ZERO;
  let currency = null;
  for (const row of visible) {
    if (row.kind !== "earning" && row.kind !== "hold") continue;
    const part = parsePart(row.amount);
    if (!part || typeof row.currency !== "string" || row.currency.length === 0) {
      return { ok: false, error: "ledger is not balanced" };
    }
    if (currency === null) currency = row.currency;
    else if (currency !== row.currency) return { ok: false, error: "currency does not match" };
    earned = add(earned, part);
    if (corrected(entries, row)) reversed = add(reversed, part);
    else if (row.kind === "hold" && !released(entries, row)) pending = add(pending, part);
    else settled = add(settled, part);
  }
  const statement = add(pending, settled);
  const sum = add(add(pending, settled), reversed);
  if (!samePart(earned, sum) || !samePart(statement, add(pending, settled))) {
    return { ok: false, error: "ledger is not balanced" };
  }
  return {
    ok: true,
    earned: format(earned),
    pending: format(pending),
    settled: format(settled),
    reversed: format(reversed),
    statement: format(statement),
    currency,
  };
}

function copyEntry(row) {
  return Object.freeze({
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    eventId: row.eventId,
    eventTenantId: row.eventTenantId,
    tenantId: row.tenantId,
    planId: row.planId,
    changedAt: row.changedAt,
    rate: row.rate,
    amount: row.amount,
    currency: row.currency,
    beneficiaryId: row.beneficiaryId,
    customerId: row.customerId,
    referenceKey: row.referenceKey ?? null,
    reason: row.reason ?? null,
  });
}

function approvalTrail(store, actor, allowed, visible) {
  const plans = store.plans.filter((plan) => allowed.has(plan.tenantId));
  const scoped = actor.role === "Customer"
    ? plans.filter((plan) => visible.some((row) => (
      row.planId === plan.planId
      && row.changedAt === plan.changedAt
      && row.tenantId === plan.tenantId
    )))
    : plans;
  return Object.freeze(scoped.map((plan) => Object.freeze({
    planId: plan.planId,
    tenantId: plan.tenantId,
    changedAt: plan.changedAt,
    status: plan.status,
    makerId: plan.makerId,
    basis: plan.basis,
    rate: plan.rate,
    requiredApprovers: Object.freeze(plan.requiredApprovers.map((approver) => Object.freeze({
      id: approver.id,
      role: approver.role,
    }))),
    approvals: Object.freeze(store.approvals.filter((row) => (
      row.planId === plan.planId
      && row.tenantId === plan.tenantId
      && row.changedAt === plan.changedAt
    )).map((row) => Object.freeze({
      approverId: row.approverId,
      approverRole: row.approverRole,
    }))),
  })));
}

function policyView(store, allowed) {
  if (!Array.isArray(store.policies)) {
    return { policyStatus: null, policies: Object.freeze([]) };
  }
  const policies = Object.freeze(store.policies.filter((row) => allowed.has(row.tenantId)).map((row) => Object.freeze({
    policyId: row.policyId,
    tenantId: row.tenantId,
    changedAt: row.changedAt,
    note: row.note,
    status: row.status,
  })));
  return {
    policyStatus: policies.length > 0 ? "pending" : null,
    policies,
  };
}

function derive(store, actor, tenantId) {
  const allowed = scopeSet(store, tenantId);
  const visible = visibleEntries(store, actor, allowed);
  const totals = accumulate(visible, store.entries);
  if (!totals.ok) return { ok: false, error: totals.error };
  const policies = policyView(store, allowed);
  return {
    ok: true,
    actor,
    allowed,
    visible,
    totals,
    policies,
    trail: approvalTrail(store, actor, allowed, visible),
  };
}

function reportView(derived) {
  return view({
    ok: true,
    reconciled: null,
    alert: null,
    earned: derived.totals.earned,
    pending: derived.totals.pending,
    settled: derived.totals.settled,
    reversed: derived.totals.reversed,
    statement: derived.totals.statement,
    currency: derived.totals.currency,
    entryCount: derived.visible.length,
    entries: Object.freeze(derived.visible.map(copyEntry)),
    approvalTrail: derived.trail,
    policyStatus: derived.policies.policyStatus,
    policies: derived.policies.policies,
  });
}

function openRead(store, input, allowedKeys) {
  if (!validStore(store)) return { ok: false, error: "unsupported field" };
  if (!Array.isArray(store.entries)) return { ok: false, error: "ledger is not configured" };
  if (!plainObject(input)) return { ok: false, error: "unsupported field" };
  const secret = problemIn(input);
  if (secret) return { ok: false, error: secret };
  if (unknownKey(input, allowedKeys)) return { ok: false, error: "unsupported field" };
  const allowed = gate(store, input, READ_ROLES);
  if (!allowed.ok) return allowed;
  return { ok: true, actor: allowed.actor, tenantId: allowed.tenantId };
}

export function readCommissionReport(store, input) {
  const opened = openRead(store, input, READ_KEYS);
  if (!opened.ok) return fail(opened.error);
  const derived = derive(store, opened.actor, opened.tenantId);
  if (!derived.ok) return fail(derived.error);
  return reportView(derived);
}

function statedOf(input) {
  const stated = {};
  for (const key of STATEMENT_FIELDS) {
    if (parsePart(input[key]) === null) return { ok: false, error: "statement is not configured" };
    stated[key] = input[key];
  }
  return { ok: true, stated };
}

export function reconcileCommissionLedger(store, input) {
  const opened = openRead(store, input, RECONCILE_KEYS);
  if (!opened.ok) return fail(opened.error);
  const stated = statedOf(input);
  if (!stated.ok) return fail(stated.error);
  const derived = derive(store, opened.actor, opened.tenantId);
  if (!derived.ok) return fail(derived.error, { stated: Object.freeze({ ...stated.stated }) });
  const fields = derived.totals;
  const matched = STATEMENT_FIELDS.every((key) => sameAmount(stated.stated[key], fields[key]));
  return view({
    ok: matched,
    error: matched ? null : "statement does not match",
    reconciled: matched,
    alert: matched ? false : true,
    earned: fields.earned,
    pending: fields.pending,
    settled: fields.settled,
    reversed: fields.reversed,
    statement: fields.statement,
    currency: fields.currency,
    entryCount: derived.visible.length,
    entries: Object.freeze(derived.visible.map(copyEntry)),
    approvalTrail: derived.trail,
    policyStatus: derived.policies.policyStatus,
    policies: derived.policies.policies,
    stated: Object.freeze({ ...stated.stated }),
  });
}

function stamp(value) {
  const namedStamp = named(value, "effective time is not configured");
  if (!namedStamp.ok) return namedStamp;
  if (!STAMP.test(namedStamp.value)) return { ok: false, error: "effective time is not configured" };
  return namedStamp;
}

export function defineCommissionPolicy(store, input) {
  if (!validStore(store)) return fail("unsupported field");
  if (!Array.isArray(store.policies)) return fail("policy is not configured");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input);
  if (secret) return fail(secret);
  if (unknownKey(input, POLICY_KEYS)) return fail("unsupported field");
  const allowed = gate(store, input, new Set(["Super Admin"]));
  if (!allowed.ok) return fail(allowed.error);
  if (input.status !== undefined && input.status !== "pending") {
    return fail("formal approval is not recorded");
  }
  const policyId = named(input.policyId, "policy is not configured");
  if (!policyId.ok) return fail(policyId.error);
  const changedAt = stamp(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error);
  let note = null;
  if (input.note !== undefined) {
    const text = named(input.note, "policy is not configured");
    if (!text.ok) return fail(text.error);
    note = text.value;
  }
  const policy = {
    policyId: policyId.value,
    tenantId: allowed.tenantId,
    changedAt: changedAt.value,
    note,
    status: "pending",
  };
  const prior = store.policies.find((row) => (
    row.policyId === policy.policyId
    && row.tenantId === policy.tenantId
    && row.changedAt === policy.changedAt
  ));
  if (prior) {
    if (prior.note === policy.note && prior.status === "pending") {
      return view({
        ok: true,
        idempotentReplay: true,
        policyStatus: "pending",
        policies: Object.freeze([Object.freeze({ ...prior })]),
      });
    }
    return fail("policy is already recorded");
  }
  const stored = Object.freeze(policy);
  store.policies.push(stored);
  return view({
    ok: true,
    policyStatus: "pending",
    policies: Object.freeze([stored]),
  });
}
