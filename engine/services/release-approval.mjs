// Final human release checklist for TASK 18.C.02.
// Security, data quality, model, operations, and business-policy each need a
// distinct same-tenant Admin and an evidence reference. Live-trading approval
// is required only for a live release. A status field does not approve
// anything. Missing evidence or a missing approver leaves the release BLOCKED.
// The audit bundle is exportable in that blocked state. Live flags stay on
// the frozen health object. This module does not deploy and does not read
// environment variables.

import { createHash } from "node:crypto";
import { health } from "../apps/web/health.mjs";
import { canEditChecklist } from "./checklist-status-view.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const PAPER_AREAS = Object.freeze([
  "security",
  "data quality",
  "model",
  "operations",
  "business-policy",
]);
const LIVE_AREA = "live-trading";
const KINDS = new Set(["paper", "live"]);
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

const OPEN_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "releaseId",
  "kind",
  "changedAt",
  "status",
  "generated",
  "paperDays",
  "outcomeCount",
]);
const APPROVAL_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "releaseId",
  "area",
  "evidence",
  "changedAt",
  "status",
  "generated",
  "paperDays",
  "outcomeCount",
]);
const READ_KEYS = Object.freeze(["actor", "tenantId", "releaseId"]);

export const RELEASE_APPROVAL_AREAS = PAPER_AREAS;

export const RELEASE_APPROVAL_LIMITATIONS = Object.freeze([
  "live trading stays OFF",
  "live orders stay locked",
  "a system pass is not an approver",
  "environment variables are not read",
  "this module does not deploy",
  "a signature image is NOT IN SOURCE",
  "a 28-day paper count is NOT IN SOURCE",
  "a 200-outcome count is NOT IN SOURCE",
]);

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
  if (!filled(actor.role)) return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: actor.role, tenantId: tenantId.value } };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function validStore(store) {
  return plainObject(store)
    && Array.isArray(store.checklists)
    && Array.isArray(store.approvals)
    && Array.isArray(store.audits);
}

function requiredAreas(kind) {
  if (kind === "live") return Object.freeze([...PAPER_AREAS, LIVE_AREA]);
  return PAPER_AREAS;
}

function checklistOf(store, tenantId, releaseId) {
  return store.checklists.find((row) => row.tenantId === tenantId && row.releaseId === releaseId) ?? null;
}

function approvalsFor(store, tenantId, releaseId) {
  return store.approvals.filter((row) => row.tenantId === tenantId && row.releaseId === releaseId);
}

function judgement(checklist, approvals) {
  const areas = requiredAreas(checklist.kind);
  for (const area of areas) {
    if (!approvals.some((row) => row.area === area)) {
      return {
        ok: false,
        error: `${area} approval is not recorded`,
        result: "blocked",
      };
    }
  }
  if (checklist.kind === "live") {
    return { ok: false, error: "live orders are locked", result: "blocked" };
  }
  return { ok: true, error: null, result: "approved" };
}

function areaRows(checklist, approvals) {
  const rows = PAPER_AREAS.map((area) => areaRow(area, true, approvals));
  rows.push(areaRow(LIVE_AREA, checklist.kind === "live", approvals));
  return Object.freeze(rows);
}

function areaRow(area, applicable, approvals) {
  const found = applicable ? approvals.find((row) => row.area === area) : null;
  return Object.freeze({
    area,
    applicable,
    approverId: found ? found.approverId : null,
    evidence: found ? found.evidence : null,
    changedAt: found ? found.changedAt : null,
  });
}

function bundleBody(checklist, approvals, audits) {
  const judged = judgement(checklist, approvals);
  return {
    releaseId: checklist.releaseId,
    tenantId: checklist.tenantId,
    kind: checklist.kind,
    makerId: checklist.makerId,
    result: judged.result,
    reason: judged.error,
    areas: areaRows(checklist, approvals).map((row) => ({
      area: row.area,
      applicable: row.applicable,
      approverId: row.approverId,
      evidence: row.evidence,
      changedAt: row.changedAt,
    })),
    audits: audits.map((row) => row.checksum),
  };
}

function view(store, tenantId, releaseId, extra) {
  const checklist = tenantId && releaseId ? checklistOf(store, tenantId, releaseId) : null;
  const approvals = checklist ? approvalsFor(store, tenantId, releaseId) : [];
  const audits = checklist
    ? store.audits.filter((row) => row.tenantId === tenantId && row.target === releaseId)
    : [];
  const judged = checklist ? judgement(checklist, approvals) : { ok: false, error: extra.error ?? null, result: "blocked" };
  const accepted = extra.ok === true && judged.ok;
  const error = extra.error ?? (accepted ? null : judged.error);
  const body = checklist ? bundleBody(checklist, approvals, audits) : null;
  return Object.freeze({
    ok: accepted,
    blocked: accepted ? null : "BLOCKED",
    error,
    reason: extra.reason ?? error,
    result: checklist ? judged.result : "blocked",
    idempotentReplay: extra.idempotentReplay === true,
    releaseId: checklist ? checklist.releaseId : null,
    kind: checklist ? checklist.kind : null,
    makerId: checklist ? checklist.makerId : null,
    areas: checklist ? areaRows(checklist, approvals) : Object.freeze([]),
    approvalCount: approvals.length,
    auditCount: audits.length,
    bundle: extra.bundle === true && body
      ? Object.freeze({ ...body, checksum: checksumOf(body) })
      : null,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    deployed: false,
    promoted: false,
    environmentHonored: false,
    credentialsStored: false,
    limitations: RELEASE_APPROVAL_LIMITATIONS,
  });
}

function fail(error, store, tenantId, releaseId) {
  if (!store || !validStore(store)) {
    return Object.freeze({
      ok: false,
      blocked: "BLOCKED",
      error,
      reason: error,
      result: "blocked",
      idempotentReplay: false,
      releaseId: null,
      kind: null,
      makerId: null,
      areas: Object.freeze([]),
      approvalCount: 0,
      auditCount: 0,
      bundle: null,
      liveTrading: health.liveTrading,
      liveOrdersLocked: health.liveOrdersLocked,
      liveEnabled: false,
      deployed: false,
      promoted: false,
      environmentHonored: false,
      credentialsStored: false,
      limitations: RELEASE_APPROVAL_LIMITATIONS,
    });
  }
  return view(store, tenantId, releaseId, { ok: false, error });
}

function gate(store, input, keys) {
  if (!validStore(store)) return { ok: false, error: "unsupported field" };
  if (!plainObject(input)) return { ok: false, error: "unsupported field" };
  const secret = problemIn(input);
  if (secret) return { ok: false, error: secret };
  if (unknownKey(input, keys)) return { ok: false, error: "unsupported field" };
  const actor = actorOf(input.actor);
  if (!actor.ok) return actor;
  const tenantId = named(input.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (!canEditChecklist(actor.actor, tenantId.value)) return { ok: false, error: "role scope denied" };
  return { ok: true, actor: actor.actor, tenantId: tenantId.value };
}

function substitute(input) {
  if (input.status !== undefined || input.generated !== undefined) return "system pass is not an approver";
  if (input.paperDays !== undefined) return "paper day count is NOT IN SOURCE";
  if (input.outcomeCount !== undefined) return "outcome count is NOT IN SOURCE";
  return null;
}

function appendAudit(store, checklist, actor, reason, before, after, approval, changedAt) {
  const body = {
    actor: actor.id,
    action: "release-approval",
    target: checklist.releaseId,
    tenantId: checklist.tenantId,
    reason,
    before,
    after,
    approval,
    changedAt,
  };
  store.audits.push(Object.freeze({ ...body, checksum: checksumOf(body) }));
}

export function createReleaseChecklist() {
  return { checklists: [], approvals: [], audits: [] };
}

export function openReleaseChecklist(store, input) {
  const ready = gate(store, input, OPEN_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const substituteError = substitute(input);
  if (substituteError) return fail(substituteError, store, ready.tenantId, null);
  const releaseId = named(input.releaseId, "release checklist is not recorded");
  if (!releaseId.ok) return fail(releaseId.error, store, ready.tenantId, null);
  const kind = named(input.kind, "release kind is not configured");
  if (!kind.ok) return fail(kind.error, store, ready.tenantId, releaseId.value);
  if (!KINDS.has(kind.value)) return fail("release kind is not configured", store, ready.tenantId, releaseId.value);
  const changedAt = named(input.changedAt, "timestamp is not configured");
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, releaseId.value);
  const existing = checklistOf(store, ready.tenantId, releaseId.value);
  if (existing) {
    if (existing.kind === kind.value && existing.makerId === ready.actor.id) {
      return view(store, ready.tenantId, releaseId.value, { ok: false, idempotentReplay: true });
    }
    return fail("release is already recorded", store, ready.tenantId, releaseId.value);
  }
  const checklist = Object.freeze({
    tenantId: ready.tenantId,
    releaseId: releaseId.value,
    kind: kind.value,
    makerId: ready.actor.id,
    changedAt: changedAt.value,
  });
  store.checklists.push(checklist);
  appendAudit(store, checklist, ready.actor, "release checklist opened", null, "blocked", null, changedAt.value);
  return view(store, ready.tenantId, releaseId.value, { ok: false });
}

export function recordReleaseApproval(store, input) {
  const ready = gate(store, input, APPROVAL_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const substituteError = substitute(input);
  if (substituteError) return fail(substituteError, store, ready.tenantId, null);
  const releaseId = named(input.releaseId, "release checklist is not recorded");
  if (!releaseId.ok) return fail(releaseId.error, store, ready.tenantId, null);
  const checklist = checklistOf(store, ready.tenantId, releaseId.value);
  if (!checklist) return fail("release checklist is not recorded", store, ready.tenantId, releaseId.value);
  const area = named(input.area, "approval area is not configured");
  if (!area.ok) return fail(area.error, store, ready.tenantId, releaseId.value);
  const allowed = requiredAreas(checklist.kind);
  if (!allowed.includes(area.value)) {
    const known = PAPER_AREAS.includes(area.value) || area.value === LIVE_AREA;
    const error = known ? "approval area is not applicable" : "approval area is not configured";
    return fail(error, store, ready.tenantId, releaseId.value);
  }
  const evidence = named(input.evidence, `${area.value} evidence is not recorded`);
  if (!evidence.ok) return fail(evidence.error, store, ready.tenantId, releaseId.value);
  const changedAt = named(input.changedAt, "timestamp is not configured");
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, releaseId.value);
  if (ready.actor.id === checklist.makerId) {
    return fail("maker cannot approve", store, ready.tenantId, releaseId.value);
  }
  const approvals = approvalsFor(store, ready.tenantId, releaseId.value);
  const prior = approvals.find((row) => row.area === area.value);
  if (prior) {
    if (prior.approverId === ready.actor.id && prior.evidence === evidence.value && prior.changedAt === changedAt.value) {
      return view(store, ready.tenantId, releaseId.value, { ok: judgement(checklist, approvals).ok, idempotentReplay: true });
    }
    return fail("approval is already recorded", store, ready.tenantId, releaseId.value);
  }
  if (approvals.some((row) => row.approverId === ready.actor.id)) {
    return fail("approvers are not distinct", store, ready.tenantId, releaseId.value);
  }
  const before = judgement(checklist, approvals).result;
  store.approvals.push(Object.freeze({
    tenantId: ready.tenantId,
    releaseId: releaseId.value,
    area: area.value,
    approverId: ready.actor.id,
    evidence: evidence.value,
    changedAt: changedAt.value,
  }));
  const afterApprovals = approvalsFor(store, ready.tenantId, releaseId.value);
  const after = judgement(checklist, afterApprovals);
  appendAudit(
    store,
    checklist,
    ready.actor,
    after.error ?? "human approval recorded",
    before,
    after.result,
    area.value,
    changedAt.value,
  );
  return view(store, ready.tenantId, releaseId.value, { ok: after.ok });
}

export function exportReleaseBundle(store, input) {
  const ready = gate(store, input, READ_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const releaseId = named(input.releaseId, "release checklist is not recorded");
  if (!releaseId.ok) return fail(releaseId.error, store, ready.tenantId, null);
  const checklist = checklistOf(store, ready.tenantId, releaseId.value);
  if (!checklist) return fail("release checklist is not recorded", store, ready.tenantId, releaseId.value);
  const approvals = approvalsFor(store, ready.tenantId, releaseId.value);
  const judged = judgement(checklist, approvals);
  return view(store, ready.tenantId, releaseId.value, {
    ok: judged.ok,
    error: judged.error,
    bundle: true,
  });
}
