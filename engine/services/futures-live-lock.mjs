// Live futures stay disabled for TASK 15.C.02.
// Configuration, credential, and order checks reject a live futures attempt.
// Separate human approval and a recorded release gate change the reason.
// They do not enable live mode. Flags are copied from the frozen health
// object. A caller environment object is not the switch. This module does
// not read environment variables, does not store a credential, and does not
// open a venue client.

import { health } from "../apps/web/health.mjs";
import { canEditChecklist } from "./checklist-status-view.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const APPROVAL_KEYS = Object.freeze(["actor", "tenantId", "changedAt"]);
const ENV_KEYS = Object.freeze(["LIVE_TRADING", "LIVE_ORDERS_LOCKED"]);
const CHECK_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "kind",
  "environment",
  "liveTrading",
  "liveOrdersLocked",
  "product",
  "order",
  "credential",
  "idempotencyKey",
  "release",
]);
const KINDS = new Set(["configuration", "credentials", "order"]);
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

export const FUTURES_LIVE_LOCK_LIMITATIONS = Object.freeze([
  "live trading stays OFF",
  "live orders stay locked",
  "environment variables are not read",
  "a ui field does not replace the health lock",
  "a credential is not stored",
  "this check does not submit an order",
  "a recorded approval does not unlock live orders",
  "a passed release gate does not unlock live orders",
  "approval signature format is NOT IN SOURCE",
  "a 28-day paper count is NOT IN SOURCE",
  "a 200-outcome count is NOT IN SOURCE",
]);

function view(fields) {
  return Object.freeze({
    ok: fields.ok === true,
    blocked: fields.ok === true ? null : "BLOCKED",
    error: fields.error ?? null,
    status: fields.error ?? null,
    kind: fields.kind ?? null,
    approvalCount: fields.approvalCount ?? 0,
    releaseRecorded: fields.releaseRecorded === true,
    idempotentReplay: fields.idempotentReplay === true,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    liveOrderSubmitted: false,
    credentialStored: false,
    venueClient: null,
    configSource: "health",
    environmentHonored: false,
    mode: "paper",
    limitations: FUTURES_LIVE_LOCK_LIMITATIONS,
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

function problemIn(value, sanctionCredential, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    return leaked(value) ? "secret value is not allowed" : null;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = problemIn(item, false, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (leaked(key)) return "secret value is not allowed";
    if (CREDENTIAL_KEYS.has(key) && !(sanctionCredential && key === "credential")) {
      return "live credentials are not allowed";
    }
    const found = problemIn(value[key], false, seen);
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
  if (actor.role !== "Admin") return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function tenantApprovals(store, tenantId) {
  return store.approvals.filter((row) => row && row.tenantId === tenantId);
}

function readEnvironment(input) {
  if (input.environment === undefined) return { ok: true };
  if (!plainObject(input.environment) || unknownKey(input.environment, ENV_KEYS)) {
    return { ok: false, error: "unsupported field" };
  }
  return { ok: true };
}

function flagText(value) {
  if (value === undefined) return { ok: true, enable: false };
  if (typeof value !== "string") return { ok: false, error: "unsupported field" };
  return { ok: true, enable: value !== health.liveTrading };
}

function flagLocked(value) {
  if (value === undefined) return { ok: true, enable: false };
  if (value === true) return { ok: true, enable: false };
  if (value === false || value === "false") return { ok: true, enable: true };
  return { ok: false, error: "unsupported field" };
}

function environmentEnables(environment) {
  if (!plainObject(environment)) return false;
  if (environment.LIVE_TRADING !== undefined && environment.LIVE_TRADING !== health.liveTrading) return true;
  const locked = environment.LIVE_ORDERS_LOCKED;
  if (locked !== undefined && locked !== true && locked !== "true") return true;
  return false;
}

function approvalGate(store, tenantId, actorId) {
  const rows = tenantApprovals(store, tenantId);
  const ids = rows.map((row) => row.approver);
  const distinct = new Set(ids);
  if (ids.length !== distinct.size) return "approvers are not distinct";
  if (distinct.size === 0) return "human approval is not recorded";
  if (distinct.size < 2) return "human approval is not separate";
  if (distinct.has(actorId)) return "maker cannot approve";
  return null;
}

function releaseProblem(release, tenantId) {
  if (!plainObject(release) || !Array.isArray(release.audits)) return "release gate is not recorded";
  const rows = release.audits.filter((row) => (
    row && row.tenantId === tenantId && row.action === "release-gate"
  ));
  if (rows.length === 0) return "release gate is not recorded";
  const latest = rows[rows.length - 1];
  if (
    latest.result === "passed"
    && latest.reason === "release gate passed"
    && latest.edited === false
    && latest.deployed === false
  ) return null;
  return "release gate is blocked";
}

export function createLiveFuturesLock() {
  return { approvals: [] };
}

export function recordLiveFuturesApproval(store, input) {
  if (!store || !Array.isArray(store.approvals)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input, false);
  if (secret) return fail(secret);
  if (unknownKey(input, APPROVAL_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const tenantId = named(input.tenantId, "role scope denied");
  if (!tenantId.ok) return fail(tenantId.error);
  if (!canEditChecklist(actor.actor, tenantId.value)) return fail("role scope denied");
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return fail(changedAt.error);
  const mine = tenantApprovals(store, tenantId.value);
  const prior = mine.find((row) => row.approver === actor.actor.id);
  if (prior) {
    if (prior.changedAt === changedAt.value) {
      return view({
        ok: true,
        kind: "approval",
        approvalCount: mine.length,
        idempotentReplay: true,
      });
    }
    return fail("approval is already recorded", { kind: "approval", approvalCount: mine.length });
  }
  if (mine.length >= 2) {
    return fail("approval is already recorded", { kind: "approval", approvalCount: mine.length });
  }
  store.approvals.push(Object.freeze({
    tenantId: tenantId.value,
    approver: actor.actor.id,
    changedAt: changedAt.value,
  }));
  return view({
    ok: true,
    kind: "approval",
    approvalCount: mine.length + 1,
    idempotentReplay: false,
  });
}

export function checkLiveFutures(store, input) {
  if (!store || !Array.isArray(store.approvals)) return fail("unsupported field");
  if (!plainObject(input)) return fail("unsupported field");
  const secret = problemIn(input, true);
  if (secret) return fail(secret);
  if (unknownKey(input, CHECK_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const tenantId = named(input.tenantId, "role scope denied");
  if (!tenantId.ok) return fail(tenantId.error);
  if (!canEditChecklist(actor.actor, tenantId.value)) return fail("role scope denied");
  const kind = named(input.kind, "unsupported field");
  if (!kind.ok || !KINDS.has(kind.value)) return fail("unsupported field");
  if (input.idempotencyKey !== undefined) {
    const key = named(input.idempotencyKey, "unsupported field");
    if (!key.ok) return fail(key.error, { kind: kind.value });
  }
  const environment = readEnvironment(input);
  if (!environment.ok) return fail(environment.error, { kind: kind.value });
  const trading = flagText(input.liveTrading);
  if (!trading.ok) return fail(trading.error, { kind: kind.value });
  const locked = flagLocked(input.liveOrdersLocked);
  if (!locked.ok) return fail(locked.error, { kind: kind.value });
  if (input.order !== undefined && !plainObject(input.order)) {
    return fail("unsupported field", { kind: kind.value });
  }
  if (input.credential !== undefined && typeof input.credential !== "string") {
    return fail("unsupported field", { kind: kind.value });
  }
  if (input.release !== undefined && (!plainObject(input.release) || !Array.isArray(input.release.audits))) {
    return fail("unsupported field", { kind: kind.value });
  }
  if (input.product !== undefined) {
    const product = named(input.product, "product is not supported");
    if (!product.ok) return fail(product.error === "unsupported field" ? "unsupported field" : "product is not supported", { kind: kind.value });
    if (product.value !== "futures") return fail("product is not supported", { kind: kind.value });
  } else if (kind.value !== "configuration") {
    return fail("product is not supported", { kind: kind.value });
  }

  const approvalCount = tenantApprovals(store, tenantId.value).length;
  const attempted = trading.enable || locked.enable || environmentEnables(input.environment);
  if (kind.value === "configuration") {
    if (input.credential !== undefined) return fail("live credentials are not allowed", { kind: kind.value, approvalCount });
    if (input.order !== undefined) return fail("live orders are locked", { kind: kind.value, approvalCount });
    if (attempted) return fail("live mode cannot be enabled", { kind: kind.value, approvalCount });
    return view({ ok: true, kind: kind.value, approvalCount });
  }

  const approval = approvalGate(store, tenantId.value, actor.actor.id);
  if (approval) return fail(approval, { kind: kind.value, approvalCount });
  const release = releaseProblem(input.release, tenantId.value);
  if (release) return fail(release, { kind: kind.value, approvalCount });
  if (kind.value === "credentials" || input.credential !== undefined) {
    return fail("live credentials are not allowed", {
      kind: kind.value,
      approvalCount,
      releaseRecorded: true,
    });
  }
  return fail("live orders are locked", {
    kind: kind.value,
    approvalCount,
    releaseRecorded: true,
  });
}
