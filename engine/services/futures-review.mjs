// Futures model and risk review for TASK 12.C.02.
// A futures paper gate needs a model card, a risk review, a futures evaluation
// report, a rollback record, and two distinct approvers.
// Absent approval stays BLOCKED. This module does not start paper execution
// and does not place an order.

import { readFileSync } from "node:fs";
import { FUTURES_FORMULA, FUTURES_NET, FUTURES_PRODUCT } from "./futures-baseline.mjs";
import { FUTURES_PREDICTION_SUPPRESSED } from "./futures-faults.mjs";
import { FUTURES_RISK_ACTION } from "./futures-risk.mjs";

const DIGITS = /^(?:0|[1-9]\d*)$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const CARD_PATH = "docs/model-cards/futures-baseline.md";
const RISK_PATH = "docs/risk-reviews/futures-baseline.md";
const FAMILIES = new Set(["linear", "inverse"]);
const APPROVALS = new Set(["model", "risk"]);
const REGISTER_KEYS = Object.freeze([
  "actor",
  "versionId",
  "modelVersion",
  "featureVersion",
  "datasetId",
  "labelVersion",
  "horizon",
  "duration",
  "contractFamily",
  "modelCard",
  "riskReview",
  "evaluation",
  "rollback",
]);
const PATH_KEYS = Object.freeze(["path"]);
const ROLLBACK_KEYS = Object.freeze(["priorVersionId", "reason"]);
const APPROVE_KEYS = Object.freeze(["actor", "versionId", "approval", "changedAt"]);
const READ_KEYS = Object.freeze(["actor", "versionId"]);
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);

function closed(error, checklist = null) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    paperExecution: false,
    enabled: false,
    ordersSubmitted: false,
    checklist,
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
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
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
  if (actor.role !== "Admin" || !filled(actor.id) || !filled(actor.tenantId)) {
    return { ok: false, error: "role scope denied" };
  }
  if (leaked(actor.id) || leaked(actor.tenantId)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, actor };
}

function durationOf(value) {
  if (value === undefined || value === null || value === "") return { ok: false, error: "horizon is not configured" };
  const digits = typeof value === "number" ? (Number.isSafeInteger(value) && value > 0 ? String(value) : "") : value;
  if (!DIGITS.test(digits) || BigInt(digits) <= 0n) return { ok: false, error: "horizon is not supported" };
  return { ok: true, value: BigInt(digits).toString() };
}

function preparedFile(path, missing) {
  const read = named(path, missing);
  if (!read.ok) return read;
  if (read.value !== CARD_PATH && read.value !== RISK_PATH) return { ok: false, error: "unsupported field" };
  try {
    return { ok: true, path: read.value, body: readFileSync(new URL(`../${read.value}`, import.meta.url), "utf8") };
  } catch {
    return { ok: false, error: missing };
  }
}

function modelCardOf(value) {
  if (!plainObject(value) || unknownKey(value, PATH_KEYS)) return { ok: false, error: "unsupported field" };
  const file = preparedFile(value.path, "model card is not configured");
  if (!file.ok) return file;
  if (file.path !== CARD_PATH) return { ok: false, error: "model card is not configured" };
  if (!file.body.includes(FUTURES_FORMULA) || !file.body.includes("Live trading stays OFF")) {
    return { ok: false, error: "model card does not match the model" };
  }
  return { ok: true, path: file.path };
}

function riskReviewOf(value) {
  if (!plainObject(value) || unknownKey(value, PATH_KEYS)) return { ok: false, error: "unsupported field" };
  const file = preparedFile(value.path, "risk review is not configured");
  if (!file.ok) return file;
  if (file.path !== RISK_PATH) return { ok: false, error: "risk review is not configured" };
  if (!file.body.includes(FUTURES_RISK_ACTION)) return { ok: false, error: "risk review does not match the model" };
  for (const fault of Object.keys(FUTURES_PREDICTION_SUPPRESSED)) {
    if (!file.body.includes(fault)) return { ok: false, error: "risk review does not match the model" };
  }
  return { ok: true, path: file.path };
}

function evaluationProblem(evaluation, identity) {
  if (!plainObject(evaluation)) return "evaluation evidence is required";
  if (evaluation.product !== FUTURES_PRODUCT || evaluation.ok !== true) return "evaluation does not match the model";
  if (evaluation.blocked !== null || evaluation.error !== null) return "evaluation evidence is required";
  if (evaluation.contractFamily !== identity.contractFamily) return "evaluation does not match the model";
  if (evaluation.modelVersion !== identity.modelVersion) return "evaluation does not match the model";
  if (evaluation.featureVersion !== identity.featureVersion) return "evaluation does not match the model";
  if (evaluation.datasetId !== identity.datasetId) return "evaluation does not match the model";
  if (evaluation.labelVersion !== identity.labelVersion) return "evaluation does not match the model";
  if (evaluation.horizon !== identity.horizon) return "evaluation does not match the model";
  if (evaluation.duration !== identity.duration) return "evaluation does not match the model";
  if (evaluation.formula !== FUTURES_FORMULA) return "evaluation does not match the model";
  if (!plainObject(evaluation.netPerformance) || evaluation.netPerformance.formula !== FUTURES_NET) {
    return "evaluation evidence is required";
  }
  if (typeof evaluation.checksum !== "string" || !CHECKSUM.test(evaluation.checksum)) {
    return "evaluation evidence is required";
  }
  if (!Number.isSafeInteger(evaluation.sampleSize) || evaluation.sampleSize < 1) {
    return "evaluation evidence is required";
  }
  return null;
}

function rollbackOf(value, versionId) {
  if (!plainObject(value) || unknownKey(value, ROLLBACK_KEYS)) return { ok: false, error: "unsupported field" };
  if (!Object.prototype.hasOwnProperty.call(value, "priorVersionId")) {
    return { ok: false, error: "unsupported field" };
  }
  const reason = named(value.reason, "rollback record is not configured");
  if (!reason.ok) return reason;
  if (value.priorVersionId === null) return { ok: true, priorVersionId: null, reason: reason.value };
  const prior = named(value.priorVersionId, "rollback record is not configured");
  if (!prior.ok) return prior;
  if (prior.value === versionId) return { ok: false, error: "rollback record is not configured" };
  return { ok: true, priorVersionId: prior.value, reason: reason.value };
}

function identityOf(input) {
  const versionId = named(input.versionId, "review is not configured");
  if (!versionId.ok) return versionId;
  const modelVersion = named(input.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return modelVersion;
  const featureVersion = named(input.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return featureVersion;
  const datasetId = named(input.datasetId, "dataset is not configured");
  if (!datasetId.ok) return datasetId;
  const labelVersion = named(input.labelVersion, "label version is not configured");
  if (!labelVersion.ok) return labelVersion;
  const horizon = named(input.horizon, "horizon is not configured");
  if (!horizon.ok) return horizon;
  const duration = durationOf(input.duration);
  if (!duration.ok) return duration;
  const family = named(input.contractFamily, "contract family is not configured");
  if (!family.ok) return family;
  if (!FAMILIES.has(family.value)) return { ok: false, error: "contract family is not supported" };
  return {
    ok: true,
    versionId: versionId.value,
    modelVersion: modelVersion.value,
    featureVersion: featureVersion.value,
    datasetId: datasetId.value,
    labelVersion: labelVersion.value,
    horizon: horizon.value,
    duration: duration.value,
    contractFamily: family.value,
  };
}

function sameReview(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function checklistOf(review) {
  const modelApprover = review.modelApproval ? review.modelApproval.approver : null;
  const riskApprover = review.riskApproval ? review.riskApproval.approver : null;
  return Object.freeze({
    modelCard: true,
    riskReview: true,
    evaluation: true,
    rollback: true,
    modelApprover,
    riskApprover,
    distinctApprovers: Boolean(modelApprover && riskApprover && modelApprover !== riskApprover),
  });
}

function view(review) {
  const checklist = checklistOf(review);
  if (!checklist.distinctApprovers) {
    const error = checklist.modelApprover ? "risk approval is not configured" : "model approval is not configured";
    return closed(error, checklist);
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    paperExecution: false,
    enabled: false,
    ordersSubmitted: false,
    checklist,
  });
}

export function createFuturesReviewStore() {
  return { reviews: new Map() };
}

export function registerFuturesReview(store, input) {
  if (!store || !(store.reviews instanceof Map)) return closed("unsupported field");
  if (!plainObject(input) || unknownKey(input, REGISTER_KEYS)) return closed("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return closed(actor.error);
  const identity = identityOf(input);
  if (!identity.ok) return closed(identity.error);
  const modelCard = modelCardOf(input.modelCard);
  if (!modelCard.ok) return closed(modelCard.error);
  const riskReview = riskReviewOf(input.riskReview);
  if (!riskReview.ok) return closed(riskReview.error);
  const evaluationError = evaluationProblem(input.evaluation, identity);
  if (evaluationError) return closed(evaluationError);
  const rollback = rollbackOf(input.rollback, identity.versionId);
  if (!rollback.ok) return closed(rollback.error);
  const record = {
    tenantId: actor.actor.tenantId,
    proposedBy: actor.actor.id,
    versionId: identity.versionId,
    modelVersion: identity.modelVersion,
    featureVersion: identity.featureVersion,
    datasetId: identity.datasetId,
    labelVersion: identity.labelVersion,
    horizon: identity.horizon,
    duration: identity.duration,
    contractFamily: identity.contractFamily,
    modelCard: modelCard.path,
    riskReview: riskReview.path,
    evaluationChecksum: input.evaluation.checksum,
    sampleSize: input.evaluation.sampleSize,
    rollback: { priorVersionId: rollback.priorVersionId, reason: rollback.reason },
    modelApproval: null,
    riskApproval: null,
  };
  const prior = store.reviews.get(record.versionId);
  if (prior) {
    if (prior.tenantId !== record.tenantId) return closed("role scope denied");
    if (!sameReview(
      { ...prior, modelApproval: null, riskApproval: null },
      { ...record, modelApproval: null, riskApproval: null },
    )) {
      return closed("review is already registered");
    }
    return view(prior);
  }
  store.reviews.set(record.versionId, record);
  return view(record);
}

export function approveFuturesReview(store, input) {
  if (!store || !(store.reviews instanceof Map)) return closed("unsupported field");
  if (!plainObject(input) || unknownKey(input, APPROVE_KEYS)) return closed("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return closed(actor.error);
  const versionId = named(input.versionId, "review is not configured");
  if (!versionId.ok) return closed(versionId.error);
  const changedAt = named(input.changedAt, "changedAt is required");
  if (!changedAt.ok) return closed(changedAt.error);
  const approval = named(input.approval, "approval is not configured");
  if (!approval.ok) return closed(approval.error);
  if (!APPROVALS.has(approval.value)) return closed("unsupported field");
  const review = store.reviews.get(versionId.value);
  if (!review) return closed("review is not configured");
  if (review.tenantId !== actor.actor.tenantId) return closed("role scope denied");
  if (actor.actor.id === review.proposedBy) return closed("maker cannot approve");
  const slot = approval.value === "model" ? "modelApproval" : "riskApproval";
  const other = approval.value === "model" ? review.riskApproval : review.modelApproval;
  if (review[slot]) {
    if (review[slot].approver !== actor.actor.id || review[slot].approvedAt !== changedAt.value) {
      return closed("approval is already recorded");
    }
    return view(review);
  }
  if (other && other.approver === actor.actor.id) return closed("approvers are not distinct");
  review[slot] = Object.freeze({ approver: actor.actor.id, approvedAt: changedAt.value });
  return view(review);
}

export function readFuturesReview(store, input) {
  if (!store || !(store.reviews instanceof Map)) return closed("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return closed("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return closed(actor.error);
  const versionId = named(input.versionId, "review is not configured");
  if (!versionId.ok) return closed(versionId.error);
  const review = store.reviews.get(versionId.value);
  if (!review) return closed("review is not configured");
  if (review.tenantId !== actor.actor.tenantId) return closed("role scope denied");
  return view(review);
}
