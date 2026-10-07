// Secret references for task 1.D.2.
// Paper mode keeps the write path disabled.
// Material is never stored, never returned, and never copied into a log or telemetry row.
// Withdrawal stays blocked. Trade stays unavailable.

import { isKnownRole } from "../../packages/contracts/src/roles.mjs";

export const DEPLOYMENT = Object.freeze({
  mode: "PAPER",
  liveTrading: "OFF",
  liveOrdersLocked: true,
  secretWrite: "not enabled",
  material: "not retrievable",
});

export const AUDIT_FIELDS = Object.freeze(["actor", "action", "target", "decision", "reason"]);

export const PERMISSION_SCOPES = Object.freeze([
  Object.freeze({ scope: "metadata.read", state: "visible" }),
  Object.freeze({ scope: "trade", state: "UNAVAILABLE" }),
  Object.freeze({ scope: "withdrawal", state: "BLOCKED" }),
]);

export const KEY_PERMISSION_CHECKS = Object.freeze([
  Object.freeze({ id: "material-masked", text: "Secret material is masked", state: "enforced" }),
  Object.freeze({ id: "material-retrievable", text: "Secret material is not retrievable", state: "enforced" }),
  Object.freeze({ id: "logs", text: "Secret material is excluded from logs", state: "enforced" }),
  Object.freeze({ id: "telemetry", text: "Secret material is excluded from telemetry", state: "enforced" }),
  Object.freeze({ id: "write", text: "Secret write is not enabled", state: "enforced" }),
  Object.freeze({ id: "trade", text: "Trade scope is unavailable", state: "UNAVAILABLE" }),
  Object.freeze({ id: "withdrawal", text: "Withdrawal permission is blocked", state: "BLOCKED" }),
  Object.freeze({ id: "kms", text: "KMS key is not configured", state: "not configured" }),
  Object.freeze({ id: "rotation", text: "Rotation is not enabled", state: "not enabled" }),
  Object.freeze({ id: "audit", text: "Audit keeps actor, action, target, decision, and reason", state: "enforced" }),
]);

const MATERIAL_KEYS = new Set([
  "material",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "apiSecret",
  "api_secret",
  "privateKey",
  "private_key",
  "token",
  "seed",
  "credential",
  "value",
  "note",
]);

const REFERENCE_IDS = new Set(["paper-market-read", "paper-desk-session"]);

const REFERENCES = Object.freeze([
  Object.freeze({
    id: "paper-market-read",
    tenantId: "desk",
    purpose: "public market read",
    manager: "secret-manager",
    kmsKey: "not configured",
    reference: "projects/paper/secrets/market-read",
    material: "masked",
    stored: false,
    rotation: "not enabled",
    revocation: "active",
  }),
  Object.freeze({
    id: "paper-desk-session",
    tenantId: "desk",
    purpose: "desk session",
    manager: "secret-manager",
    kmsKey: "not configured",
    reference: "projects/paper/secrets/desk-session",
    material: "masked",
    stored: false,
    rotation: "not enabled",
    revocation: "active",
  }),
]);

const revocation = new Map(REFERENCES.map((row) => [row.id, "active"]));

function knownReference(id) {
  return typeof id === "string" && REFERENCE_IDS.has(id) ? id : null;
}

function actorRole(actor) {
  const role = actor && typeof actor === "object" ? actor.role : null;
  if (!isKnownRole(role)) return null;
  if (actor.tenantId != null && actor.tenantId !== "desk") return null;
  return role;
}

function copyReference(id) {
  const source = REFERENCES.find((row) => row.id === id);
  if (!source) return null;
  return Object.freeze({
    ...source,
    material: "masked",
    stored: false,
    revocation: revocation.get(id) ?? "active",
    liveTrading: "OFF",
    liveOrdersLocked: true,
  });
}

export function listReferences() {
  return REFERENCES.map((row) => copyReference(row.id));
}

export function readReference(id) {
  const reference = copyReference(knownReference(id));
  if (!reference) return { ok: false, error: "unknown reference", reference: null };
  return { ok: true, error: null, reference };
}

export function retrieveMaterial() {
  return Object.freeze({
    ok: false,
    error: "secret material is not retrievable",
    material: null,
  });
}

export function describeSecretPath() {
  return Object.freeze({
    mode: DEPLOYMENT.mode,
    manager: "secret-manager",
    kmsKey: "not configured",
    referenceShape: "projects/paper/secrets/<name>",
    write: "not enabled",
    read: "not retrievable",
    rotation: "not enabled",
    revocation: "metadata only",
    audit: AUDIT_FIELDS,
    scopes: PERMISSION_SCOPES,
  });
}

function record(sinks, row) {
  const safe = Object.freeze({
    actor: row.actor,
    action: row.action,
    target: row.target,
    decision: row.decision,
    reason: row.reason,
  });
  const telemetry = Object.freeze({
    source: "secret-reference",
    action: row.action,
    target: row.target,
    decision: row.decision,
    reason: row.reason,
  });
  if (Array.isArray(sinks.log)) sinks.log.push(safe);
  if (Array.isArray(sinks.telemetry)) sinks.telemetry.push(telemetry);
  return { safe, telemetry };
}

function sinksOf(input) {
  return {
    log: input && Array.isArray(input.log) ? input.log : null,
    telemetry: input && Array.isArray(input.telemetry) ? input.telemetry : null,
  };
}

export function submitSecretMaterial(input) {
  const source = input && typeof input === "object" ? input : {};
  const sinks = sinksOf(source);
  const role = actorRole(source.actor);
  const target = knownReference(source.referenceId) ?? "none";
  if (!role || role !== "Admin") {
    record(sinks, {
      actor: role ?? "unknown",
      action: "secret-write",
      target,
      decision: "denied",
      reason: "role scope denied",
    });
    return { ok: false, error: "role scope denied", reference: null };
  }
  record(sinks, {
    actor: "Admin",
    action: "secret-write",
    target,
    decision: "denied",
    reason: "secret write is not enabled",
  });
  return { ok: false, error: "secret write is not enabled", reference: target === "none" ? null : copyReference(target) };
}

export function rotateReference(input) {
  const source = input && typeof input === "object" ? input : {};
  const sinks = sinksOf(source);
  const role = actorRole(source.actor);
  const target = knownReference(source.referenceId) ?? "none";
  const reason = !role || role !== "Admin" ? "role scope denied" : "rotation is not enabled";
  record(sinks, {
    actor: role === "Admin" ? "Admin" : role ?? "unknown",
    action: "secret-rotate",
    target,
    decision: "denied",
    reason,
  });
  return { ok: false, error: reason, reference: null };
}

export function revokeReference(input) {
  const source = input && typeof input === "object" ? input : {};
  const sinks = sinksOf(source);
  const role = actorRole(source.actor);
  const target = knownReference(source.referenceId);
  if (!role || role !== "Admin") {
    record(sinks, {
      actor: role ?? "unknown",
      action: "secret-revoke",
      target: target ?? "none",
      decision: "denied",
      reason: "role scope denied",
    });
    return { ok: false, error: "role scope denied", reference: null };
  }
  if (!target) {
    record(sinks, {
      actor: "Admin",
      action: "secret-revoke",
      target: "none",
      decision: "denied",
      reason: "unknown reference",
    });
    return { ok: false, error: "unknown reference", reference: null };
  }
  revocation.set(target, "revoked");
  const reference = copyReference(target);
  record(sinks, {
    actor: "Admin",
    action: "secret-revoke",
    target,
    decision: "revoked",
    reason: "metadata only",
  });
  return { ok: true, error: null, reference };
}

export function materialKeys() {
  return [...MATERIAL_KEYS];
}
