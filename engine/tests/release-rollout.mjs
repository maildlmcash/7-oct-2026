import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { canEditChecklist } from "../services/checklist-status-view.mjs";
import * as rollout from "../services/release-rollout.mjs";
import {
  RELEASE_ROLLOUT_LIMITATIONS,
  ROLLOUT_STAGES,
  createReleaseRollout,
  readReleaseRollout,
  reconcileUncertainOrder,
  recordReleaseEvidence,
  recordReleaseManifest,
  recordRolloutStage,
  recordSchemaMigration,
  recordUncertainOrder,
  rollbackRelease,
  stopOrderIntents,
} from "../services/release-rollout.mjs";

const WHEN = "2026-10-07T00:00:00Z";
const ADMIN = { id: "fixture-admin", role: "Admin", tenantId: "tenant-a" };
const CUSTOMER = { id: "fixture-customer", role: "Customer", tenantId: "tenant-a" };
const OTHER = { id: "fixture-admin-b", role: "Admin", tenantId: "tenant-b" };
const ADAPTERS = Object.freeze([{ name: "fixture-adapter", version: "fixture-adapter-1" }]);

function manifest(extra = {}) {
  return {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    schemaVersion: "fixture-schema-1",
    adapterVersions: ADAPTERS,
    modelVersion: "fixture-model-1",
    featureVersion: "fixture-feature-1",
    riskVersion: "fixture-risk-1",
    commissionVersion: "fixture-commission-1",
    testEvidence: "fixture-evidence",
    changedAt: WHEN,
    ...extra,
  };
}

function passStages(store, sourceHash, schemaVersion, environment = "staging") {
  for (const stage of ROLLOUT_STAGES) {
    const recorded = recordRolloutStage(store, {
      actor: ADMIN,
      tenantId: "tenant-a",
      environment,
      sourceHash,
      stage,
      ok: true,
      changedAt: WHEN,
    });
    assert.equal(recorded.ok, true, recorded.error ?? stage);
    assert.equal(recorded.schemaVersion, schemaVersion);
  }
}

test("a failed health stage halts the later rollout", () => {
  const store = createReleaseRollout();
  const recorded = recordReleaseManifest(store, manifest());
  assert.equal(recorded.ok, true);
  assert.equal(recorded.liveTrading, "OFF");
  assert.equal(recorded.liveOrdersLocked, true);
  assert.equal(recorded.deployed, false);
  assert.equal(recorded.environmentHonored, false);
  assert.equal(recorded.credentialsStored, false);
  assert.equal(recorded.mode, "paper");
  assert.equal(recorded.served, false);

  const share = recordReleaseManifest(store, manifest({
    sourceHash: "fixture-build-share",
    canaryPercentage: "fixture-canary-share",
  }));
  assert.equal(share.ok, false);
  assert.equal(share.error, "canary percentage is NOT IN SOURCE");
  assert.equal(JSON.stringify(share).includes("fixture-canary-share"), false);
  assert.equal(store.manifests.length, 1);

  const flagged = recordReleaseManifest(store, manifest({
    sourceHash: "fixture-build-flag",
    flags: { "fixture-flag": true },
  }));
  assert.equal(flagged.ok, false);
  assert.equal(flagged.error, "feature flag is not configured");
  assert.equal(JSON.stringify(flagged).includes("fixture-flag"), false);

  const enabled = recordReleaseManifest(store, manifest({
    sourceHash: "fixture-build-live",
    flags: { LIVE_TRADING: "ON", LIVE_ORDERS_LOCKED: false },
  }));
  assert.equal(enabled.ok, false);
  assert.equal(enabled.error, "live mode cannot be enabled");
  assert.equal(enabled.liveTrading, "OFF");
  assert.equal(enabled.liveOrdersLocked, true);
  assert.equal(JSON.stringify(enabled).includes("ON"), false);
  assert.equal(store.manifests.length, 1);

  const migrations = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    stage: "schema migrations",
    ok: true,
    changedAt: WHEN,
  });
  assert.equal(migrations.ok, true);
  assert.equal(migrations.idempotentReplay, false);
  const again = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    stage: "schema migrations",
    ok: true,
    changedAt: WHEN,
  });
  assert.equal(again.idempotentReplay, true);
  assert.equal(store.stages.length, 1);

  const readiness = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    stage: "readiness",
    ok: false,
    changedAt: WHEN,
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.blocked, "BLOCKED");
  assert.equal(readiness.error, "readiness is not verified");
  assert.equal(readiness.halted, true);
  assert.equal(readiness.canaryHalted, true);
  assert.equal(readiness.served, false);
  assert.equal(readiness.deployed, false);

  const ingest = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    stage: "ingest/workers",
    ok: true,
    changedAt: WHEN,
  });
  assert.equal(ingest.ok, false);
  assert.equal(ingest.error, "rollout is halted");
  assert.equal(ingest.canaryHalted, true);
  assert.equal(ingest.served, false);
  assert.equal(store.stages.length, 2);
  assert.equal(store.builds.length, 0);

  recordReleaseManifest(store, manifest({
    environment: "test",
    sourceHash: "fixture-build-health",
    schemaVersion: "fixture-schema-1",
  }));
  for (const stage of ["schema migrations", "readiness", "ingest/workers"]) {
    const step = recordRolloutStage(store, {
      actor: ADMIN,
      tenantId: "tenant-a",
      environment: "test",
      sourceHash: "fixture-build-health",
      stage,
      ok: true,
      changedAt: WHEN,
    });
    assert.equal(step.ok, true, stage);
  }
  const dataHealth = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "test",
    sourceHash: "fixture-build-health",
    stage: "data health",
    ok: false,
    changedAt: WHEN,
  });
  assert.equal(dataHealth.error, "data health is not verified");
  assert.equal(dataHealth.canaryHalted, true);
  const hub = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "test",
    sourceHash: "fixture-build-health",
    stage: "Hub/API",
    ok: true,
    changedAt: WHEN,
  });
  assert.equal(hub.error, "rollout is halted");
  assert.equal(hub.served, false);
  const staging = readReleaseRollout(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
  });
  assert.equal(staging.currentSourceHash, null);
  const isolated = readReleaseRollout(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "prod",
  });
  assert.equal(isolated.currentSourceHash, null);
  assert.equal(isolated.served, false);
});

test("rollback restores the prior build and keeps evidence", () => {
  const store = createReleaseRollout();
  recordReleaseManifest(store, manifest());
  passStages(store, "fixture-build-1", "fixture-schema-1");
  const paper = recordReleaseEvidence(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    kind: "paper",
    evidenceId: "fixture-paper",
    changedAt: WHEN,
  });
  const audit = recordReleaseEvidence(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    kind: "audit",
    evidenceId: "fixture-audit",
    changedAt: WHEN,
  });
  assert.equal(paper.paperCount, 1);
  assert.equal(audit.auditCount, 1);
  assert.equal(store.evidence.length, 2);

  const current = readReleaseRollout(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
  });
  assert.equal(current.currentSourceHash, "fixture-build-1");
  assert.equal(current.currentSchemaVersion, "fixture-schema-1");
  assert.equal(current.served, true);
  assert.equal(current.dataCompatible, true);
  assert.deepEqual(current.compatibility, ["fixture-schema-1"]);

  recordReleaseManifest(store, manifest({
    sourceHash: "fixture-build-2",
    schemaVersion: "fixture-schema-2",
  }));
  const skipped = recordRolloutStage(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-2",
    stage: "schema migrations",
    ok: true,
    changedAt: WHEN,
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.error, "migration is not compatible");
  assert.equal(skipped.canaryHalted, true);
  assert.equal(skipped.currentSourceHash, "fixture-build-1");

  const contract = recordSchemaMigration(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    phase: "contract",
    fromSchema: "fixture-schema-1",
    toSchema: "fixture-schema-2",
    drops: ["audit"],
    changedAt: WHEN,
  });
  assert.equal(contract.ok, false);
  assert.equal(contract.error, "audit evidence is kept");
  assert.equal(store.evidence.length, 2);
  assert.equal(store.evidence[1].evidenceId, "fixture-audit");
  assert.equal(store.migrations.length, 0);

  const otherDrop = recordSchemaMigration(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    phase: "expand",
    fromSchema: "fixture-schema-1",
    toSchema: "fixture-schema-2",
    drops: ["fixture-column"],
    changedAt: WHEN,
  });
  assert.equal(otherDrop.error, "migration is not compatible");
  assert.equal(JSON.stringify(otherDrop).includes("fixture-column"), false);

  const phase = recordSchemaMigration(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    phase: "fixture-phase",
    fromSchema: "fixture-schema-1",
    toSchema: "fixture-schema-2",
    changedAt: WHEN,
  });
  assert.equal(phase.error, "migration phase is not configured");
  assert.equal(JSON.stringify(phase).includes("fixture-phase"), false);

  const expand = recordSchemaMigration(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    phase: "expand",
    fromSchema: "fixture-schema-1",
    toSchema: "fixture-schema-2",
    changedAt: WHEN,
  });
  assert.equal(expand.ok, true);
  assert.deepEqual(expand.compatibility, ["fixture-schema-1", "fixture-schema-2"]);
  assert.equal(store.evidence.length, 2);
  assert.equal(store.migrations.length, 1);

  const plainContract = recordSchemaMigration(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    phase: "contract",
    fromSchema: "fixture-schema-2",
    toSchema: "fixture-schema-1",
    changedAt: WHEN,
  });
  assert.equal(plainContract.error, "prior build is still compatible");
  assert.equal(store.migrations.length, 1);

  recordReleaseManifest(store, manifest({
    sourceHash: "fixture-build-3",
    schemaVersion: "fixture-schema-2",
  }));
  passStages(store, "fixture-build-3", "fixture-schema-2");
  const advanced = readReleaseRollout(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
  });
  assert.equal(advanced.currentSourceHash, "fixture-build-3");
  assert.equal(advanced.currentSchemaVersion, "fixture-schema-2");
  assert.equal(advanced.served, true);
  const order = recordUncertainOrder(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    orderId: "fixture-order",
    changedAt: WHEN,
  });
  assert.equal(order.ok, true);
  assert.equal(store.orders[0].state, "uncertain");

  const early = rollbackRelease(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    changedAt: WHEN,
  });
  assert.equal(early.error, "new order intents are not stopped");
  assert.equal(early.currentSourceHash, "fixture-build-3");
  assert.equal(store.evidence.length, 2);

  stopOrderIntents(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    changedAt: WHEN,
  });
  const open = rollbackRelease(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    changedAt: WHEN,
  });
  assert.equal(open.error, "uncertain orders are not reconciled");
  assert.equal(store.orders[0].state, "uncertain");
  assert.equal(store.evidence[0].evidenceId, "fixture-paper");

  const reconciled = reconcileUncertainOrder(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    orderId: "fixture-order",
    changedAt: WHEN,
  });
  assert.equal(reconciled.reconciled, true);
  assert.equal(store.orders[0].state, "uncertain");
  assert.equal(store.reconciliations.length, 1);

  const restored = rollbackRelease(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    changedAt: WHEN,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, true);
  assert.equal(restored.currentSourceHash, "fixture-build-1");
  assert.equal(restored.currentSchemaVersion, "fixture-schema-1");
  assert.equal(restored.dataCompatible, true);
  assert.deepEqual(restored.compatibility, ["fixture-schema-1", "fixture-schema-2"]);
  assert.equal(restored.paperCount, 1);
  assert.equal(restored.auditCount, 1);
  assert.equal(restored.evidenceCount, 2);
  assert.equal(restored.served, true);
  assert.equal(restored.deployed, false);
  assert.equal(restored.liveTrading, "OFF");
  assert.equal(restored.liveOrdersLocked, true);
  assert.equal(store.evidence.length, 2);
  assert.equal(store.evidence[0].evidenceId, "fixture-paper");
  assert.equal(store.evidence[1].evidenceId, "fixture-audit");
  assert.equal(store.orders.length, 1);

  const replay = rollbackRelease(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    changedAt: WHEN,
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.currentSourceHash, "fixture-build-1");
  assert.equal(store.builds.filter((row) => row.environment === "staging").length, 3);

  const prod = readReleaseRollout(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    environment: "prod",
  });
  assert.equal(prod.currentSourceHash, null);
  assert.equal(prod.paperCount, 1);
});

test("rollout stays paper-only and does not deploy", () => {
  const store = createReleaseRollout();
  const denied = recordReleaseManifest(store, manifest({ actor: CUSTOMER }));
  assert.equal(denied.error, "role scope denied");
  assert.equal(store.manifests.length, 0);
  const outside = recordRolloutStage(store, {
    actor: OTHER,
    tenantId: "tenant-a",
    environment: "staging",
    sourceHash: "fixture-build-1",
    stage: "readiness",
    ok: false,
    changedAt: WHEN,
  });
  assert.equal(outside.error, "role scope denied");
  assert.equal(store.stages.length, 0);

  const secret = recordReleaseManifest(store, manifest({
    sourceHash: "bearer fixture-token",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  assert.equal(store.manifests.length, 0);

  const credential = recordReleaseManifest(store, manifest({
    apiKey: "fixture-key",
  }));
  assert.equal(credential.error, "live credentials are not allowed");
  assert.equal(JSON.stringify(credential).includes("fixture-key"), false);

  const isolated = recordReleaseManifest(store, manifest({ environment: "fixture-env" }));
  assert.equal(isolated.error, "environment is not isolated");
  assert.equal(JSON.stringify(isolated).includes("fixture-env"), false);

  const removed = recordReleaseEvidence(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    kind: "audit",
    evidenceId: "fixture-audit",
    changedAt: WHEN,
    drop: true,
  });
  assert.equal(removed.error, "unsupported field");
  assert.equal(store.evidence.length, 0);

  assert.equal(canEditChecklist(CUSTOMER, "tenant-a"), false);
  assert.equal(canEditChecklist(ADMIN, "tenant-a"), true);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  assert.equal(health.liveTrading, "OFF");

  const source = readFileSync(new URL("../services/release-rollout.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("Math.round"), false);
  assert.equal(source.includes("DROP TABLE"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("evaluateReleaseGate"), false);
  assert.equal(/\d+%/.test(source), false);
  assert.deepEqual(Object.keys(rollout), [
    "RELEASE_ROLLOUT_LIMITATIONS",
    "ROLLOUT_STAGES",
    "createReleaseRollout",
    "readReleaseRollout",
    "reconcileUncertainOrder",
    "recordReleaseEvidence",
    "recordReleaseManifest",
    "recordRolloutStage",
    "recordSchemaMigration",
    "recordUncertainOrder",
    "rollbackRelease",
    "stopOrderIntents",
  ]);
  assert.equal(RELEASE_ROLLOUT_LIMITATIONS.includes("a canary percentage is NOT IN SOURCE"), true);
  assert.equal(RELEASE_ROLLOUT_LIMITATIONS.includes("this module does not deploy"), true);
  assert.deepEqual(ROLLOUT_STAGES, [
    "schema migrations",
    "readiness",
    "ingest/workers",
    "data health",
    "Hub/API",
    "web assets",
  ]);
});
