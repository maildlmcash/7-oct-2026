// The source names no identity provider and no MFA header.
// x-mfa-proof is an implementation choice. A missing provider fails closed.
export const MFA_HEADER = "x-mfa-proof";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["checklist.write"]);
const REASONS = new Set([
  "mfa provider is not configured",
  "mfa required",
  "mfa denied",
  "mfa verified",
]);

function auditList(store) {
  if (!Array.isArray(store)) return null;
  return store;
}

export function appendPrivilegedAudit(store, event) {
  const audit = auditList(store);
  if (!audit) return { ok: false, error: "audit records are append-only" };
  const actor = typeof event?.actor === "string" && UUID_PATTERN.test(event.actor) ? event.actor : null;
  const action = ACTIONS.has(event?.action) ? event.action : null;
  const target = typeof event?.target === "string" && event.target.length > 0 ? event.target : null;
  const reason = REASONS.has(event?.reason) ? event.reason : null;
  const time = typeof event?.time === "number" && Number.isFinite(event.time) ? event.time : null;
  if (!actor || !action || !target || !reason || time == null) {
    return { ok: false, error: "audit records are append-only" };
  }
  const row = Object.freeze({ actor, action, target, reason, time });
  audit.push(row);
  return { ok: true, event: row };
}

export function searchPrivilegedAudit(store, query = {}) {
  const audit = auditList(store);
  if (!audit) return [];
  const matches = audit.filter((event) => {
    if (query.actor != null && event.actor !== query.actor) return false;
    if (query.action != null && event.action !== query.action) return false;
    if (query.target != null && event.target !== query.target) return false;
    if (query.reason != null && event.reason !== query.reason) return false;
    if (typeof query.since === "number" && event.time < query.since) return false;
    if (typeof query.until === "number" && event.time > query.until) return false;
    return true;
  });
  return matches.map((event) => ({
    actor: event.actor,
    action: event.action,
    target: event.target,
    reason: event.reason,
    time: event.time,
  }));
}

function providerReason(provider, proof) {
  if (provider == null || typeof provider.verify !== "function") {
    return "mfa provider is not configured";
  }
  if (typeof proof !== "string" || proof.length === 0) return "mfa required";
  let verified = false;
  try {
    verified = provider.verify(proof) === true;
  } catch {
    verified = false;
  }
  return verified ? "mfa verified" : "mfa denied";
}

export function gatePrivilegedAction(store, input) {
  const reason = providerReason(input?.provider, input?.proof);
  const recorded = appendPrivilegedAudit(store, {
    actor: input?.actor,
    action: input?.action,
    target: input?.target,
    reason,
    time: input?.time,
  });
  if (!recorded.ok) return { ok: false, error: "audit records are append-only", status: 403 };
  if (reason === "mfa verified") return { ok: true, status: 200 };
  if (reason === "mfa provider is not configured") {
    return { ok: false, error: reason, blocked: "BLOCKED", status: 503 };
  }
  return { ok: false, error: reason, status: 403 };
}
