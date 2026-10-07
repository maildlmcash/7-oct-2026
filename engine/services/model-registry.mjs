// Spot model registry for TASK 11.C.02.
// A candidate records the artifact, code, data, and feature versions, the training
// window, the owner, and the walk-forward report when one is supplied.
// Promotion is a separate approval. Missing or mismatched evaluation evidence is denied
// and writes no audit. The proposer cannot approve.
// Rollback selects a prior promoted version and appends an audit event.
// The superseded version stays in the lineage.
// Same-tenant Admin is the existing write grant. This module does not place orders
// and does not enable live trading.
// SHA-256 is the checksum already used for a pinned snapshot. The source names no algorithm.

import { createHash } from "node:crypto";
import { SPOT_HORIZONS } from "./label-definitions.mjs";

const DIGITS = /^(?:0|[1-9]\d*)$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SECRET_KEYS = new Set([
  "password",
  "otp",
  "apisecret",
  "api_secret",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "seedphrase",
  "seed_phrase",
  "accesstoken",
  "access_token",
  "authorization",
  "cookie",
  "credential",
  "token",
  "secret",
]);
const REGISTER_KEYS = Object.freeze([
  "actor",
  "lineageId",
  "artifact",
  "codeVersion",
  "dataVersion",
  "featureVersion",
  "modelVersion",
  "datasetId",
  "horizon",
  "trainingWindow",
  "evaluation",
  "owner",
]);
const CHANGE_KEYS = Object.freeze(["actor", "lineageId", "versionId", "changedAt", "reason"]);
const READ_KEYS = Object.freeze(["actor", "lineageId"]);
const WINDOW_KEYS = Object.freeze(["from", "to"]);
const EVIDENCE_FIELDS = Object.freeze([
  "netPerformance",
  "benchmark",
  "benchmarkDifference",
  "brier",
  "logLoss",
  "calibration",
  "drawdown",
]);

export const MODEL_REGISTRY_CHECKSUM = "sha256";

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    record: null,
    current: null,
    versions: null,
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

function timeValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

function timeText(value) {
  return BigInt(typeof value === "number" ? String(value) : value).toString();
}

function compareTime(left, right) {
  const a = timeText(left);
  const b = timeText(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function storeOf(store) {
  return Boolean(store)
    && Array.isArray(store.versions)
    && Array.isArray(store.audits)
    && store.promoted instanceof Map
    && store.current instanceof Map
    && Number.isSafeInteger(store.nextId);
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
  return createHash(MODEL_REGISTRY_CHECKSUM).update(canonical(value)).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function leaked(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
}

function secretInput(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => secretInput(item));
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && typeof item === "string" && item.length >= 4) return true;
    if (secretInput(item)) return true;
  }
  return false;
}

function text(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function actorOf(actor) {
  if (!plainObject(actor) || actor.role !== "Admin" || !filled(actor.id) || !filled(actor.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  return { ok: true, actor };
}

function trainingWindowOf(value) {
  if (value === undefined || value === null) return { ok: false, error: "training window is not configured" };
  if (!plainObject(value) || unknownKey(value, WINDOW_KEYS)) return { ok: false, error: "unsupported field" };
  if (!timeValue(value.from) || !timeValue(value.to)) return { ok: false, error: "unsupported field" };
  if (compareTime(value.from, value.to) >= 0) return { ok: false, error: "training window is not configured" };
  return { ok: true, from: timeText(value.from), to: timeText(value.to) };
}

function evidenceProblem(evaluation, identity) {
  if (evaluation === undefined || evaluation === null) return "evaluation evidence is required";
  if (!plainObject(evaluation)) return "evaluation evidence is required";
  if (evaluation.ok !== true || evaluation.blocked !== null || evaluation.error !== null) {
    return "evaluation evidence is required";
  }
  if (typeof evaluation.checksum !== "string" || !CHECKSUM.test(evaluation.checksum)) {
    return "evaluation evidence is required";
  }
  if (typeof evaluation.formula !== "string" || !filled(evaluation.formula)) {
    return "evaluation evidence is required";
  }
  if (!Number.isSafeInteger(evaluation.sampleSize) || evaluation.sampleSize < 0) {
    return "evaluation evidence is required";
  }
  for (const field of EVIDENCE_FIELDS) {
    if (!plainObject(evaluation[field])) return "evaluation evidence is required";
  }
  if (
    evaluation.modelVersion !== identity.modelVersion
    || evaluation.featureVersion !== identity.featureVersion
    || evaluation.datasetId !== identity.datasetId
    || evaluation.horizon !== identity.horizon
  ) {
    return "evaluation does not match the model";
  }
  return null;
}

function lineageTenant(store, lineageId) {
  const prior = store.versions.find((record) => record.lineageId === lineageId);
  return prior ? prior.tenantId : null;
}

function snapshot(record, approval, current) {
  return JSON.stringify({
    id: record.id,
    lineageId: record.lineageId,
    modelVersion: record.modelVersion,
    featureVersion: record.featureVersion,
    codeVersion: record.codeVersion,
    dataVersion: record.dataVersion,
    datasetId: record.datasetId,
    horizon: record.horizon,
    artifact: record.artifact,
    owner: record.owner,
    promoted: Boolean(approval),
    current: current === true,
    approver: approval?.approver ?? null,
    checksum: record.checksum,
  });
}

function view(store, record) {
  const approval = store.promoted.get(record.id) ?? null;
  const current = store.current.get(record.lineageId) === record.id;
  return Object.freeze({
    id: record.id,
    lineageId: record.lineageId,
    tenantId: record.tenantId,
    artifact: record.artifact,
    codeVersion: record.codeVersion,
    dataVersion: record.dataVersion,
    featureVersion: record.featureVersion,
    modelVersion: record.modelVersion,
    datasetId: record.datasetId,
    horizon: record.horizon,
    trainingWindow: record.trainingWindow,
    evaluation: record.evaluation,
    owner: record.owner,
    proposedBy: record.proposedBy,
    approver: approval?.approver ?? null,
    approvedAt: approval?.approvedAt ?? null,
    promoted: Boolean(approval),
    current,
    evaluationChecksum: record.evaluationChecksum,
    checksum: record.checksum,
  });
}

function writeAudit(store, input) {
  store.audits.push(Object.freeze({
    tenantId: input.tenantId,
    actor: input.actor,
    action: input.action,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    reason: input.reason,
    approval: input.actor,
    changedAt: input.changedAt,
    configChecksum: input.configChecksum,
    lineageId: input.lineageId,
  }));
}

function changedAtOf(value) {
  if (value === undefined || value === null || value === "") return { ok: false, error: "changedAt is required" };
  if (!filled(value) || leaked(value)) return { ok: false, error: "unsupported field" };
  return { ok: true, value };
}

function reasonOf(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

export function createModelRegistry() {
  return {
    nextId: 1,
    versions: [],
    audits: [],
    promoted: new Map(),
    current: new Map(),
  };
}

export function registerModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, REGISTER_KEYS) || secretInput(input)) {
    return fail("unsupported field");
  }
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const lineage = text(input.lineageId, "model version is not configured");
  if (!lineage.ok) return fail(lineage.error);
  const tenant = lineageTenant(store, lineage.value);
  if (tenant && tenant !== actor.actor.tenantId) return fail("role scope denied");
  const artifact = text(input.artifact, "artifact is not configured");
  if (!artifact.ok) return fail(artifact.error);
  const codeVersion = text(input.codeVersion, "code version is not configured");
  if (!codeVersion.ok) return fail(codeVersion.error);
  const dataVersion = text(input.dataVersion, "data version is not configured");
  if (!dataVersion.ok) return fail(dataVersion.error);
  const featureVersion = text(input.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return fail(featureVersion.error);
  const modelVersion = text(input.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return fail(modelVersion.error);
  const datasetId = text(input.datasetId, "dataset is not configured");
  if (!datasetId.ok) return fail(datasetId.error);
  const horizon = text(input.horizon, "horizon is not configured");
  if (!horizon.ok) return fail(horizon.error);
  if (!SPOT_HORIZONS.includes(horizon.value)) return fail("horizon is not supported");
  const trainingWindow = trainingWindowOf(input.trainingWindow);
  if (!trainingWindow.ok) return fail(trainingWindow.error);
  const owner = text(input.owner, "owner is not configured");
  if (!owner.ok) return fail(owner.error);
  const duplicate = store.versions.find((record) => (
    record.lineageId === lineage.value && record.modelVersion === modelVersion.value
  ));
  if (duplicate) return fail("model version is already registered");
  const identity = {
    modelVersion: modelVersion.value,
    featureVersion: featureVersion.value,
    datasetId: datasetId.value,
    horizon: horizon.value,
  };
  let evaluation = null;
  if (input.evaluation !== undefined && input.evaluation !== null) {
    const problem = evidenceProblem(input.evaluation, identity);
    if (problem) return fail(problem);
    evaluation = deepFreeze(structuredClone(input.evaluation));
  }
  const body = {
    lineageId: lineage.value,
    tenantId: actor.actor.tenantId,
    artifact: artifact.value,
    codeVersion: codeVersion.value,
    dataVersion: dataVersion.value,
    featureVersion: featureVersion.value,
    modelVersion: modelVersion.value,
    datasetId: datasetId.value,
    horizon: horizon.value,
    trainingWindow: { from: trainingWindow.from, to: trainingWindow.to },
    owner: owner.value,
    evaluationChecksum: evaluation ? evaluation.checksum : null,
  };
  const record = deepFreeze({
    id: String(store.nextId),
    ...body,
    proposedBy: actor.actor.id,
    evaluation,
    checksum: checksumOf(body),
  });
  store.nextId += 1;
  store.versions.push(record);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    record: view(store, record),
    current: null,
    versions: null,
  });
}

function changeTarget(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, CHANGE_KEYS) || secretInput(input)) {
    return fail("unsupported field");
  }
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const lineage = text(input.lineageId, "model version is not configured");
  if (!lineage.ok) return fail(lineage.error);
  const versionId = text(input.versionId, "model version is not configured");
  if (!versionId.ok) return fail(versionId.error);
  const record = store.versions.find((item) => item.id === versionId.value && item.lineageId === lineage.value);
  if (!record) return fail("model version is not configured");
  if (record.tenantId !== actor.actor.tenantId) return fail("role scope denied");
  const changedAt = changedAtOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error);
  const reason = reasonOf(input.reason);
  if (!reason.ok) return fail(reason.error);
  return { ok: true, actor: actor.actor, record, changedAt: changedAt.value, reason: reason.value };
}

export function promoteModel(store, input) {
  const target = changeTarget(store, input);
  if (!target.ok) return target;
  if (target.actor.id === target.record.proposedBy) return fail("maker cannot approve");
  if (store.promoted.has(target.record.id)) return fail("version is already approved");
  const problem = evidenceProblem(target.record.evaluation, target.record);
  if (problem) return fail(problem);
  const previousId = store.current.get(target.record.lineageId) ?? null;
  const previous = previousId ? store.versions.find((item) => item.id === previousId) : null;
  store.promoted.set(target.record.id, {
    approver: target.actor.id,
    approvedAt: target.changedAt,
  });
  store.current.set(target.record.lineageId, target.record.id);
  writeAudit(store, {
    tenantId: target.record.tenantId,
    actor: target.actor.id,
    action: "promote",
    beforeValue: previous ? snapshot(previous, store.promoted.get(previous.id), true) : null,
    afterValue: snapshot(target.record, store.promoted.get(target.record.id), true),
    reason: target.reason,
    changedAt: target.changedAt,
    configChecksum: target.record.checksum,
    lineageId: target.record.lineageId,
  });
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    record: view(store, target.record),
    current: view(store, target.record),
    versions: null,
  });
}

export function rollbackModel(store, input) {
  const target = changeTarget(store, input);
  if (!target.ok) return target;
  if (!store.promoted.has(target.record.id)) return fail("last known good is required");
  if (store.current.get(target.record.lineageId) === target.record.id) {
    return fail("version is already current");
  }
  const previousId = store.current.get(target.record.lineageId) ?? null;
  const previous = previousId ? store.versions.find((item) => item.id === previousId) : null;
  store.current.set(target.record.lineageId, target.record.id);
  writeAudit(store, {
    tenantId: target.record.tenantId,
    actor: target.actor.id,
    action: "rollback",
    beforeValue: previous ? snapshot(previous, store.promoted.get(previous.id), true) : null,
    afterValue: snapshot(target.record, store.promoted.get(target.record.id), true),
    reason: target.reason,
    changedAt: target.changedAt,
    configChecksum: target.record.checksum,
    lineageId: target.record.lineageId,
  });
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    record: view(store, target.record),
    current: view(store, target.record),
    versions: null,
  });
}

export function readCurrentModel(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const lineage = text(input.lineageId, "model version is not configured");
  if (!lineage.ok) return fail(lineage.error);
  const tenant = lineageTenant(store, lineage.value);
  if (!tenant) return fail("model version is not configured");
  if (tenant !== actor.actor.tenantId) return fail("role scope denied");
  const currentId = store.current.get(lineage.value);
  if (!currentId) return fail("model is not promoted");
  const record = store.versions.find((item) => item.id === currentId);
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    record: view(store, record),
    current: view(store, record),
    versions: null,
  });
}

export function readModelVersions(store, input) {
  if (!storeOf(store)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const lineage = text(input.lineageId, "model version is not configured");
  if (!lineage.ok) return fail(lineage.error);
  const rows = store.versions.filter((record) => record.lineageId === lineage.value);
  if (rows.length === 0) return fail("model version is not configured");
  if (rows[0].tenantId !== actor.actor.tenantId) return fail("role scope denied");
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    record: null,
    current: store.current.has(lineage.value) ? view(store, rows.find((row) => row.id === store.current.get(lineage.value))) : null,
    versions: Object.freeze(rows.map((record) => view(store, record))),
  });
}
