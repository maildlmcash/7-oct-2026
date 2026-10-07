import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { BASELINE_FEATURES, createBaselineStore, registerBaselineModel } from "../services/baseline-model.mjs";
import {
  SPOT_HORIZONS,
  createLabelStore,
  registerLabelVersion,
} from "../services/label-definitions.mjs";
import * as registry from "../services/model-registry.mjs";
import {
  createModelRegistry,
  promoteModel,
  readCurrentModel,
  readModelVersions,
  registerModel,
  rollbackModel,
} from "../services/model-registry.mjs";
import { evaluateWalkForward, pinWalkForwardManifest } from "../services/walk-forward.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Owner, artifact, code version, and data version are caller fixtures.
// The source names those fields and does not name their values.
const TIME = 1499865549590;
const MINUTE = 60000;
const DAY = 86400000;
const BIDS = [["0.0025", "3"], ["0.0024", "1"]];
const ASKS = [["0.0026", "3"], ["0.0027", "1"]];
const maker = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const reviewer = { id: "admin-2", role: "Admin", tenantId: "tenant-1" };

function features(value) {
  const row = {};
  for (const name of BASELINE_FEATURES) row[name] = value;
  return row;
}

function evaluation(modelVersion) {
  const baseline = createBaselineStore();
  registerBaselineModel(baseline, { version: modelVersion });
  const labels = createLabelStore();
  registerLabelVersion(labels, {
    version: "fixture-label-1",
    horizons: [...SPOT_HORIZONS],
    deadZone: "0.01",
    observationWindow: { from: TIME, to: TIME + DAY },
    testWindow: { from: TIME + DAY + 1, to: TIME + DAY + DAY },
  });
  const pinned = pinWalkForwardManifest({
    datasetId: "fixture-dataset",
    modelVersion,
    featureVersion: "fixture-features",
    labelVersion: "fixture-label-1",
    horizon: "1m",
    window: { from: TIME, to: TIME + DAY },
    folds: [{ name: "fold-1", trainEnd: TIME - 1, testStart: TIME, testEnd: TIME }],
    rows: [{
      name: "row-1",
      fold: "fold-1",
      regime: "fixture-regime",
      features: features("1"),
      leakage: {
        receiveTime: TIME + 1,
        lagThreshold: 1000,
        features: [{
          name: "spread",
          source: "fixture-source",
          eventTime: TIME,
          window: { from: TIME, to: TIME },
          quality: { healthy: true, reason: null },
        }],
      },
      label: {
        cutoff: TIME,
        start: { bid: "99", ask: "101", time: TIME },
        outcome: { bid: "100", ask: "102", time: TIME + MINUTE },
        quality: { healthy: true, reason: null },
      },
      cost: {
        bids: BIDS.map((level) => [...level]),
        asks: ASKS.map((level) => [...level]),
        quantity: "3",
        feeRate: "0.001",
      },
      benchmarkNet: "0",
    }],
  });
  assert.equal(pinned.ok, true, pinned.error);
  const report = evaluateWalkForward({ baseline, labels, manifest: pinned.manifest });
  assert.equal(report.ok, true, report.error);
  return report;
}

function registration(modelVersion, extra) {
  return {
    actor: maker,
    lineageId: "fixture-lineage",
    artifact: "fixture-artifact",
    codeVersion: "fixture-code",
    dataVersion: "fixture-data",
    featureVersion: "fixture-features",
    modelVersion,
    datasetId: "fixture-dataset",
    horizon: "1m",
    trainingWindow: { from: TIME - DAY, to: TIME },
    owner: "fixture-owner",
    evaluation: evaluation(modelVersion),
    ...extra,
  };
}

test("promotion keeps the prior model and rollback writes an audit event", () => {
  const store = createModelRegistry();
  const first = registerModel(store, registration("fixture-baseline"));
  assert.equal(first.ok, true, first.error);
  assert.equal(first.record.promoted, false);
  assert.equal(first.record.current, false);
  assert.equal(first.record.evaluation.checksum, first.record.evaluationChecksum);
  assert.equal(readCurrentModel(store, { actor: maker, lineageId: "fixture-lineage" }).error, "model is not promoted");

  const self = promoteModel(store, {
    actor: maker,
    lineageId: "fixture-lineage",
    versionId: first.record.id,
    changedAt: "2026-10-06T00:00:00Z",
  });
  assert.equal(self.error, "maker cannot approve");
  assert.equal(store.audits.length, 0);
  assert.equal(readCurrentModel(store, { actor: reviewer, lineageId: "fixture-lineage" }).error, "model is not promoted");

  const promoted = promoteModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: first.record.id,
    changedAt: "2026-10-06T01:00:00Z",
    reason: "fixture approval",
  });
  assert.equal(promoted.ok, true, promoted.error);
  assert.equal(promoted.current.modelVersion, "fixture-baseline");
  assert.equal(promoted.current.approver, reviewer.id);
  assert.equal(promoted.current.current, true);
  assert.equal(promoted.record.evaluation.netPerformance.value, "-199/6375");
  const firstAudit = store.audits[0];
  assert.equal(firstAudit.action, "promote");
  assert.equal(firstAudit.beforeValue, null);
  assert.equal(firstAudit.approval, reviewer.id);
  assert.equal(firstAudit.configChecksum, first.record.checksum);
  assert.equal(firstAudit.actor, reviewer.id);

  const second = registerModel(store, registration("fixture-baseline-2", { artifact: "fixture-artifact-2" }));
  assert.equal(second.ok, true, second.error);
  assert.equal(readCurrentModel(store, { actor: maker, lineageId: "fixture-lineage" }).record.id, first.record.id);
  const versionsWhileSecondIsPending = readModelVersions(store, { actor: maker, lineageId: "fixture-lineage" });
  assert.equal(versionsWhileSecondIsPending.versions.length, 2);
  assert.equal(versionsWhileSecondIsPending.versions[0].modelVersion, "fixture-baseline");

  const next = promoteModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: second.record.id,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(next.ok, true, next.error);
  assert.equal(readCurrentModel(store, { actor: reviewer, lineageId: "fixture-lineage" }).record.modelVersion, "fixture-baseline-2");
  assert.equal(readModelVersions(store, { actor: reviewer, lineageId: "fixture-lineage" }).versions[0].id, first.record.id);

  const restored = rollbackModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: first.record.id,
    changedAt: "2026-10-06T03:00:00Z",
    reason: "fixture rollback",
  });
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.current.id, first.record.id);
  assert.equal(restored.current.modelVersion, "fixture-baseline");
  assert.equal(restored.current.artifact, "fixture-artifact");
  assert.equal(readCurrentModel(store, { actor: maker, lineageId: "fixture-lineage" }).record.id, first.record.id);
  const after = readModelVersions(store, { actor: maker, lineageId: "fixture-lineage" });
  assert.equal(after.versions.length, 2);
  assert.equal(after.versions[1].id, second.record.id);
  assert.equal(after.versions[1].promoted, true);
  assert.equal(after.versions[1].current, false);
  assert.equal(store.audits[0], firstAudit);
  assert.throws(() => {
    firstAudit.action = "rollback";
  });
  assert.deepEqual(store.audits.map((audit) => audit.action), ["promote", "promote", "rollback"]);
  assert.equal(JSON.parse(store.audits[2].beforeValue).modelVersion, "fixture-baseline-2");
  assert.equal(JSON.parse(store.audits[2].afterValue).modelVersion, "fixture-baseline");
  assert.equal(store.audits[2].configChecksum, first.record.checksum);

  const again = promoteModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: first.record.id,
    changedAt: "2026-10-06T04:00:00Z",
  });
  assert.equal(again.error, "version is already approved");
  assert.equal(store.audits.length, 3);
  const customer = rollbackModel(store, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
    lineageId: "fixture-lineage",
    versionId: second.record.id,
    changedAt: "2026-10-06T05:00:00Z",
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(readCurrentModel(store, { actor: maker, lineageId: "fixture-lineage" }).record.id, first.record.id);
});

test("promotion is denied without evaluation evidence and a failed rollback writes nothing", () => {
  const store = createModelRegistry();
  const draft = registerModel(store, registration("fixture-baseline", { evaluation: undefined }));
  assert.equal(draft.ok, true, draft.error);
  assert.equal(draft.record.evaluation, null);
  const denied = promoteModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: draft.record.id,
    changedAt: "2026-10-06T01:00:00Z",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.blocked, "BLOCKED");
  assert.equal(denied.error, "evaluation evidence is required");
  assert.equal(denied.current, null);
  assert.equal(store.audits.length, 0);
  assert.equal(readCurrentModel(store, { actor: maker, lineageId: "fixture-lineage" }).error, "model is not promoted");

  const pending = rollbackModel(store, {
    actor: reviewer,
    lineageId: "fixture-lineage",
    versionId: draft.record.id,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(pending.error, "last known good is required");
  assert.equal(store.audits.length, 0);
  assert.equal(store.versions.length, 1);

  const mismatched = structuredClone(evaluation("fixture-baseline"));
  mismatched.modelVersion = "other-model";
  const rejected = registerModel(store, registration("fixture-baseline-2", { evaluation: mismatched }));
  assert.equal(rejected.error, "evaluation does not match the model");
  assert.equal(store.versions.length, 1);
  assert.equal(JSON.stringify(rejected).includes("other-model"), false);

  const incomplete = structuredClone(evaluation("fixture-baseline"));
  delete incomplete.brier;
  const missingMetric = registerModel(store, registration("fixture-baseline-3", { evaluation: incomplete }));
  assert.equal(missingMetric.error, "evaluation evidence is required");
  assert.equal(store.versions.length, 1);

  assert.equal(registerModel(store, registration("fixture-baseline-4", { artifact: "" })).error, "artifact is not configured");
  assert.equal(registerModel(store, registration("fixture-baseline-4", { owner: "   " })).error, "owner is not configured");
  assert.equal(registerModel(store, registration("fixture-baseline-4", { trainingWindow: null })).error, "training window is not configured");
  assert.equal(registerModel(store, registration("fixture-baseline-4", { codeVersion: "" })).error, "code version is not configured");
  assert.equal(registerModel(store, registration("fixture-baseline-4", { dataVersion: "" })).error, "data version is not configured");
  assert.equal(registerModel(store, registration("fixture-baseline-4", { horizon: "1d" })).error, "horizon is not supported");
  assert.equal(store.versions.length, 1);

  const secret = registerModel(store, registration("fixture-baseline-4", {
    artifact: "BEGIN PRIVATE KEY",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(JSON.stringify(store.versions).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(store.versions.length, 1);
});

test("the model registry export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(registry).sort(), [
    "MODEL_REGISTRY_CHECKSUM",
    "createModelRegistry",
    "promoteModel",
    "readCurrentModel",
    "readModelVersions",
    "registerModel",
    "rollbackModel",
  ]);
  const source = readFileSync(new URL("../services/model-registry.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("NO_TRADE"), false);
  assert.equal(source.includes("ABSTAIN"), false);
  assert.equal(source.includes("S_fut"), false);
  assert.equal(health.status, "ok");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
