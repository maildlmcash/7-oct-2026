// Staged rollout and rollback for TASK 18.C.01.
// Design section 20 starts paper-only, then applies schema migrations, verifies
// readiness, starts ingest and workers, verifies data health, starts Hub/API,
// and serves web assets. A failed stage halts the later stages. The source
// names no canary percentage. Expand keeps the prior schema readable. A
// contract is not applied while a prior build remains. Rollback restores the
// prior build and does not delete paper or audit evidence. Flags come from
// the frozen health object. This module does not deploy and does not read
// environment variables.

import { health } from "../apps/web/health.mjs";
import { canEditChecklist } from "./checklist-status-view.mjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);
const FLAG_KEYS = Object.freeze(["LIVE_TRADING", "LIVE_ORDERS_LOCKED"]);
const ENVIRONMENTS = Object.freeze(["dev", "test", "staging", "prod"]);
const EVIDENCE_KINDS = new Set(["paper", "audit"]);
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

export const ROLLOUT_STAGES = Object.freeze([
  "schema migrations",
  "readiness",
  "ingest/workers",
  "data health",
  "Hub/API",
  "web assets",
]);

const STAGE_FAILURE = Object.freeze({
  "schema migrations": "schema migration is not verified",
  readiness: "readiness is not verified",
  "ingest/workers": "ingest is not verified",
  "data health": "data health is not verified",
  "Hub/API": "hub is not verified",
  "web assets": "web assets are not verified",
});

const MANIFEST_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "environment",
  "sourceHash",
  "schemaVersion",
  "adapterVersions",
  "modelVersion",
  "featureVersion",
  "riskVersion",
  "commissionVersion",
  "testEvidence",
  "flags",
  "canaryPercentage",
  "changedAt",
]);

const MIGRATION_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "environment",
  "phase",
  "fromSchema",
  "toSchema",
  "drops",
  "changedAt",
]);

const STAGE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "environment",
  "sourceHash",
  "stage",
  "ok",
  "changedAt",
]);

const EVIDENCE_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "kind",
  "evidenceId",
  "changedAt",
]);

const ORDER_KEYS = Object.freeze(["actor", "tenantId", "orderId", "changedAt"]);
const STOP_KEYS = Object.freeze(["actor", "tenantId", "environment", "changedAt"]);
const ROLLBACK_KEYS = Object.freeze([
  "actor",
  "tenantId",
  "environment",
  "sourceHash",
  "changedAt",
]);
const READ_KEYS = Object.freeze(["actor", "tenantId", "environment"]);

export const RELEASE_ROLLOUT_LIMITATIONS = Object.freeze([
  "live trading stays OFF",
  "live orders stay locked",
  "environment variables are not read",
  "this module does not deploy",
  "a canary percentage is NOT IN SOURCE",
  "a contract migration is not applied while a prior build remains",
  "paper evidence is kept",
  "audit evidence is kept",
  "separate credentials are not stored",
  "human release approval is not this module",
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

function stampOf(value) {
  if (value === undefined) return { ok: true, value: null };
  return named(value, "unsupported field");
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

function environmentOf(value) {
  const environment = named(value, "environment is not isolated");
  if (!environment.ok) return environment;
  if (!ENVIRONMENTS.includes(environment.value)) return { ok: false, error: "environment is not isolated" };
  return environment;
}

function validStore(store) {
  return plainObject(store)
    && Array.isArray(store.manifests)
    && Array.isArray(store.stages)
    && Array.isArray(store.migrations)
    && Array.isArray(store.evidence)
    && Array.isArray(store.orders)
    && Array.isArray(store.reconciliations)
    && Array.isArray(store.stops)
    && Array.isArray(store.halts)
    && Array.isArray(store.builds);
}

function currentBuild(store, environment) {
  let found = null;
  for (const row of store.builds) {
    if (row.environment === environment) found = row;
  }
  return found;
}

function compatibilityList(store, environment) {
  const versions = [];
  for (const migration of store.migrations) {
    if (migration.environment !== environment || migration.phase !== "expand") continue;
    if (!versions.includes(migration.fromSchema)) versions.push(migration.fromSchema);
    if (!versions.includes(migration.toSchema)) versions.push(migration.toSchema);
  }
  const current = currentBuild(store, environment);
  if (current && !versions.includes(current.schemaVersion)) versions.push(current.schemaVersion);
  return Object.freeze(versions);
}

function evidenceCounts(store, tenantId) {
  let paperCount = 0;
  let auditCount = 0;
  for (const row of store.evidence) {
    if (row.tenantId !== tenantId) continue;
    if (row.kind === "paper") paperCount += 1;
    else if (row.kind === "audit") auditCount += 1;
  }
  return { evidenceCount: paperCount + auditCount, paperCount, auditCount };
}

function intentsStopped(store, environment) {
  return store.stops.some((row) => row.environment === environment && row.stopped === true);
}

function openOrders(store, tenantId) {
  return store.orders.some((order) => (
    order.tenantId === tenantId
    && !store.reconciliations.some((row) => row.tenantId === tenantId && row.orderId === order.orderId)
  ));
}

function rolloutHalted(store, environment, sourceHash) {
  return store.halts.some((row) => row.environment === environment && row.sourceHash === sourceHash);
}

function stageRows(store, environment, sourceHash) {
  return store.stages.filter((row) => row.environment === environment && row.sourceHash === sourceHash);
}

function nextStage(store, environment, sourceHash) {
  const done = new Set(stageRows(store, environment, sourceHash).map((row) => row.stage));
  for (const stage of ROLLOUT_STAGES) {
    if (!done.has(stage)) return stage;
  }
  return null;
}

function migrationReady(store, environment, schemaVersion) {
  const current = currentBuild(store, environment);
  if (!current || current.schemaVersion === schemaVersion) return true;
  return store.migrations.some((migration) => (
    migration.environment === environment
    && migration.phase === "expand"
    && migration.fromSchema === current.schemaVersion
    && migration.toSchema === schemaVersion
  ));
}

function manifestOf(store, environment, sourceHash) {
  for (const row of store.manifests) {
    if (row.environment === environment && row.sourceHash === sourceHash) return row;
  }
  return null;
}

function completeBuild(store, environment, sourceHash) {
  const rows = stageRows(store, environment, sourceHash);
  if (rolloutHalted(store, environment, sourceHash)) return false;
  if (rows.length !== ROLLOUT_STAGES.length) return false;
  return rows.every((row) => row.ok === true);
}

function view(store, tenantId, environment, extra) {
  const counts = tenantId ? evidenceCounts(store, tenantId) : { evidenceCount: 0, paperCount: 0, auditCount: 0 };
  const current = environment ? currentBuild(store, environment) : null;
  const versions = environment ? compatibilityList(store, environment) : Object.freeze([]);
  const compatible = current ? versions.includes(current.schemaVersion) : versions.length > 0;
  return Object.freeze({
    ok: extra.ok === true,
    blocked: extra.ok === true ? null : "BLOCKED",
    error: extra.error ?? null,
    reason: extra.reason ?? extra.error ?? null,
    halted: extra.halted === true,
    canaryHalted: extra.canaryHalted === true,
    served: current ? completeBuild(store, environment, current.sourceHash) : false,
    deployed: false,
    edited: false,
    idempotentReplay: extra.idempotentReplay === true,
    restored: extra.restored === true,
    reconciled: extra.reconciled === true,
    intentsStopped: environment ? intentsStopped(store, environment) : false,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
    liveEnabled: false,
    environmentHonored: false,
    credentialsStored: false,
    mode: "paper",
    environment: environment ?? null,
    currentSourceHash: current ? current.sourceHash : null,
    currentSchemaVersion: current ? current.schemaVersion : null,
    sourceHash: extra.sourceHash ?? null,
    schemaVersion: extra.schemaVersion ?? null,
    stage: extra.stage ?? null,
    evidenceCount: counts.evidenceCount,
    paperCount: counts.paperCount,
    auditCount: counts.auditCount,
    dataCompatible: compatible,
    compatibility: versions,
    limitations: RELEASE_ROLLOUT_LIMITATIONS,
  });
}

function fail(error, store, tenantId, environment, extra = {}) {
  if (!store || !validStore(store)) {
    return Object.freeze({
      ok: false,
      blocked: "BLOCKED",
      error,
      reason: error,
      halted: false,
      canaryHalted: false,
      served: false,
      deployed: false,
      edited: false,
      idempotentReplay: false,
      restored: false,
      reconciled: false,
      intentsStopped: false,
      liveTrading: health.liveTrading,
      liveOrdersLocked: health.liveOrdersLocked,
      liveEnabled: false,
      environmentHonored: false,
      credentialsStored: false,
      mode: "paper",
      environment: null,
      currentSourceHash: null,
      currentSchemaVersion: null,
      sourceHash: null,
      schemaVersion: null,
      stage: null,
      evidenceCount: 0,
      paperCount: 0,
      auditCount: 0,
      dataCompatible: false,
      compatibility: Object.freeze([]),
      limitations: RELEASE_ROLLOUT_LIMITATIONS,
    });
  }
  return view(store, tenantId, environment, { ok: false, error, ...extra });
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

function flagProblem(flags) {
  if (flags === undefined) return null;
  if (!plainObject(flags)) return "unsupported field";
  if (unknownKey(flags, FLAG_KEYS)) return "feature flag is not configured";
  if (flags.LIVE_TRADING !== undefined && flags.LIVE_TRADING !== health.liveTrading) {
    return "live mode cannot be enabled";
  }
  if (flags.LIVE_ORDERS_LOCKED !== undefined && flags.LIVE_ORDERS_LOCKED !== health.liveOrdersLocked) {
    return "live mode cannot be enabled";
  }
  return null;
}

export function createReleaseRollout() {
  return {
    manifests: [],
    stages: [],
    migrations: [],
    evidence: [],
    orders: [],
    reconciliations: [],
    stops: [],
    halts: [],
    builds: [],
  };
}

export function recordReleaseManifest(store, input) {
  const ready = gate(store, input, MANIFEST_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  if (input.canaryPercentage !== undefined) {
    return fail("canary percentage is NOT IN SOURCE", store, ready.tenantId, null);
  }
  const flags = flagProblem(input.flags);
  if (flags) return fail(flags, store, ready.tenantId, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const sourceHash = named(input.sourceHash, "source hash is required");
  if (!sourceHash.ok) return fail(sourceHash.error, store, ready.tenantId, environment.value);
  const schemaVersion = named(input.schemaVersion, "schema version is required");
  if (!schemaVersion.ok) return fail(schemaVersion.error, store, ready.tenantId, environment.value);
  const adapters = adapterVersions(input.adapterVersions);
  if (!adapters.ok) return fail(adapters.error, store, ready.tenantId, environment.value);
  const modelVersion = named(input.modelVersion, "model version is required");
  if (!modelVersion.ok) return fail(modelVersion.error, store, ready.tenantId, environment.value);
  const featureVersion = named(input.featureVersion, "feature version is required");
  if (!featureVersion.ok) return fail(featureVersion.error, store, ready.tenantId, environment.value);
  const riskVersion = named(input.riskVersion, "risk version is required");
  if (!riskVersion.ok) return fail(riskVersion.error, store, ready.tenantId, environment.value);
  const commissionVersion = named(input.commissionVersion, "commission version is required");
  if (!commissionVersion.ok) return fail(commissionVersion.error, store, ready.tenantId, environment.value);
  const testEvidence = named(input.testEvidence, "test evidence is required");
  if (!testEvidence.ok) return fail(testEvidence.error, store, ready.tenantId, environment.value);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, environment.value);
  const existing = manifestOf(store, environment.value, sourceHash.value);
  const identity = {
    environment: environment.value,
    sourceHash: sourceHash.value,
    schemaVersion: schemaVersion.value,
    modelVersion: modelVersion.value,
    featureVersion: featureVersion.value,
    riskVersion: riskVersion.value,
    commissionVersion: commissionVersion.value,
    testEvidence: testEvidence.value,
    adaptersKey: adapters.key,
  };
  if (existing) {
    if (sameManifest(existing, identity)) {
      return view(store, ready.tenantId, environment.value, {
        ok: true,
        idempotentReplay: true,
        sourceHash: sourceHash.value,
        schemaVersion: schemaVersion.value,
      });
    }
    return fail("source hash is already recorded", store, ready.tenantId, environment.value);
  }
  store.manifests.push(Object.freeze({
    tenantId: ready.tenantId,
    actorId: ready.actor.id,
    ...identity,
    adapterVersions: adapters.value,
    changedAt: changedAt.value,
    liveTrading: health.liveTrading,
    liveOrdersLocked: health.liveOrdersLocked,
  }));
  return view(store, ready.tenantId, environment.value, {
    ok: true,
    sourceHash: sourceHash.value,
    schemaVersion: schemaVersion.value,
  });
}

function sameManifest(row, identity) {
  return row.environment === identity.environment
    && row.sourceHash === identity.sourceHash
    && row.schemaVersion === identity.schemaVersion
    && row.modelVersion === identity.modelVersion
    && row.featureVersion === identity.featureVersion
    && row.riskVersion === identity.riskVersion
    && row.commissionVersion === identity.commissionVersion
    && row.testEvidence === identity.testEvidence
    && row.adaptersKey === identity.adaptersKey;
}

function adapterVersions(value) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "adapter versions are required" };
  const rows = [];
  for (const row of value) {
    if (!plainObject(row) || unknownKey(row, ["name", "version"])) {
      return { ok: false, error: "adapter versions are required" };
    }
    const name = named(row.name, "adapter versions are required");
    if (!name.ok) return name;
    const version = named(row.version, "adapter versions are required");
    if (!version.ok) return version;
    rows.push({ name: name.value, version: version.value });
  }
  return {
    ok: true,
    value: Object.freeze(rows.map((row) => Object.freeze(row))),
    key: JSON.stringify(rows),
  };
}

function dropProblem(drops) {
  if (drops === undefined) return null;
  if (!Array.isArray(drops)) return "unsupported field";
  for (const item of drops) {
    if (item === "paper") return "paper evidence is kept";
    if (item === "audit") return "audit evidence is kept";
    if (!filled(item) || leaked(item)) {
      return leaked(item) ? "secret value is not allowed" : "unsupported field";
    }
    return "migration is not compatible";
  }
  return null;
}

export function recordSchemaMigration(store, input) {
  const ready = gate(store, input, MIGRATION_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const dropped = dropProblem(input.drops);
  if (dropped) return fail(dropped, store, ready.tenantId, environment.value);
  const phase = named(input.phase, "migration phase is not configured");
  if (!phase.ok) return fail(phase.error, store, ready.tenantId, environment.value);
  if (phase.value !== "expand" && phase.value !== "contract") {
    return fail("migration phase is not configured", store, ready.tenantId, environment.value);
  }
  const fromSchema = named(input.fromSchema, "schema version is required");
  if (!fromSchema.ok) return fail(fromSchema.error, store, ready.tenantId, environment.value);
  const toSchema = named(input.toSchema, "schema version is required");
  if (!toSchema.ok) return fail(toSchema.error, store, ready.tenantId, environment.value);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, environment.value);
  if (phase.value === "contract") {
    return fail("prior build is still compatible", store, ready.tenantId, environment.value);
  }
  if (fromSchema.value === toSchema.value) {
    return fail("migration is not compatible", store, ready.tenantId, environment.value);
  }
  const existing = store.migrations.find((migration) => (
    migration.environment === environment.value
    && migration.phase === "expand"
    && migration.fromSchema === fromSchema.value
    && migration.toSchema === toSchema.value
  ));
  if (existing) {
    return view(store, ready.tenantId, environment.value, {
      ok: true,
      idempotentReplay: true,
      schemaVersion: toSchema.value,
    });
  }
  store.migrations.push(Object.freeze({
    tenantId: ready.tenantId,
    environment: environment.value,
    phase: "expand",
    fromSchema: fromSchema.value,
    toSchema: toSchema.value,
    changedAt: changedAt.value,
  }));
  return view(store, ready.tenantId, environment.value, {
    ok: true,
    schemaVersion: toSchema.value,
  });
}

function rememberHalt(store, ready, environment, sourceHash, stage, changedAt, reason) {
  store.stages.push(Object.freeze({
    tenantId: ready.tenantId,
    environment,
    sourceHash,
    stage,
    ok: false,
    changedAt,
  }));
  store.halts.push(Object.freeze({
    tenantId: ready.tenantId,
    environment,
    sourceHash,
    stage,
    reason,
    changedAt,
  }));
}

export function recordRolloutStage(store, input) {
  const ready = gate(store, input, STAGE_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const sourceHash = named(input.sourceHash, "source hash is required");
  if (!sourceHash.ok) return fail(sourceHash.error, store, ready.tenantId, environment.value);
  const stage = named(input.stage, "stage is not configured");
  if (!stage.ok) return fail(stage.error, store, ready.tenantId, environment.value);
  if (!ROLLOUT_STAGES.includes(stage.value)) {
    return fail("stage is not configured", store, ready.tenantId, environment.value);
  }
  if (typeof input.ok !== "boolean") return fail("stage result is required", store, ready.tenantId, environment.value);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, environment.value);
  const manifest = manifestOf(store, environment.value, sourceHash.value);
  if (!manifest) return fail("release manifest is not recorded", store, ready.tenantId, environment.value);
  const prior = stageRows(store, environment.value, sourceHash.value).find((row) => row.stage === stage.value);
  if (prior) {
    if (prior.ok === input.ok) {
      const halt = store.halts.find((row) => (
        row.environment === environment.value
        && row.sourceHash === sourceHash.value
        && row.stage === stage.value
      ));
      const failed = prior.ok === false;
      const reason = failed ? (halt ? halt.reason : STAGE_FAILURE[stage.value]) : null;
      return view(store, ready.tenantId, environment.value, {
        ok: !failed,
        error: reason,
        reason,
        idempotentReplay: true,
        halted: failed,
        canaryHalted: failed,
        sourceHash: sourceHash.value,
        schemaVersion: manifest.schemaVersion,
        stage: stage.value,
      });
    }
    return fail("stage is already recorded", store, ready.tenantId, environment.value, {
      halted: true,
      canaryHalted: true,
      sourceHash: sourceHash.value,
      stage: stage.value,
    });
  }
  if (rolloutHalted(store, environment.value, sourceHash.value)) {
    return fail("rollout is halted", store, ready.tenantId, environment.value, {
      halted: true,
      canaryHalted: true,
      sourceHash: sourceHash.value,
      stage: stage.value,
    });
  }
  if (completeBuild(store, environment.value, sourceHash.value)) {
    return fail("rollout is already current", store, ready.tenantId, environment.value, {
      sourceHash: sourceHash.value,
      stage: stage.value,
    });
  }
  if (nextStage(store, environment.value, sourceHash.value) !== stage.value) {
    return fail("stage is out of order", store, ready.tenantId, environment.value, {
      sourceHash: sourceHash.value,
      stage: stage.value,
    });
  }
  if (input.ok === true && stage.value === "schema migrations" && !migrationReady(store, environment.value, manifest.schemaVersion)) {
    rememberHalt(
      store,
      ready,
      environment.value,
      sourceHash.value,
      stage.value,
      changedAt.value,
      "migration is not compatible",
    );
    return view(store, ready.tenantId, environment.value, {
      ok: false,
      error: "migration is not compatible",
      halted: true,
      canaryHalted: true,
      sourceHash: sourceHash.value,
      schemaVersion: manifest.schemaVersion,
      stage: stage.value,
    });
  }
  if (input.ok === false) {
    const reason = STAGE_FAILURE[stage.value];
    rememberHalt(store, ready, environment.value, sourceHash.value, stage.value, changedAt.value, reason);
    return view(store, ready.tenantId, environment.value, {
      ok: false,
      error: reason,
      halted: true,
      canaryHalted: true,
      sourceHash: sourceHash.value,
      schemaVersion: manifest.schemaVersion,
      stage: stage.value,
    });
  }
  store.stages.push(Object.freeze({
    tenantId: ready.tenantId,
    environment: environment.value,
    sourceHash: sourceHash.value,
    stage: stage.value,
    ok: true,
    changedAt: changedAt.value,
  }));
  if (completeBuild(store, environment.value, sourceHash.value)) {
    store.builds.push(Object.freeze({
      tenantId: ready.tenantId,
      environment: environment.value,
      sourceHash: manifest.sourceHash,
      schemaVersion: manifest.schemaVersion,
      changedAt: changedAt.value,
    }));
  }
  return view(store, ready.tenantId, environment.value, {
    ok: true,
    sourceHash: sourceHash.value,
    schemaVersion: manifest.schemaVersion,
    stage: stage.value,
  });
}

export function recordReleaseEvidence(store, input) {
  const ready = gate(store, input, EVIDENCE_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const kind = named(input.kind, "evidence kind is not configured");
  if (!kind.ok) return fail(kind.error, store, ready.tenantId, null);
  if (!EVIDENCE_KINDS.has(kind.value)) {
    return fail("evidence kind is not configured", store, ready.tenantId, null);
  }
  const evidenceId = named(input.evidenceId, "evidence is not configured");
  if (!evidenceId.ok) return fail(evidenceId.error, store, ready.tenantId, null);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, null);
  const existing = store.evidence.find((row) => row.tenantId === ready.tenantId && row.evidenceId === evidenceId.value);
  if (existing) {
    if (existing.kind === kind.value) {
      return view(store, ready.tenantId, null, { ok: true, idempotentReplay: true });
    }
    return fail("evidence is already recorded", store, ready.tenantId, null);
  }
  store.evidence.push(Object.freeze({
    tenantId: ready.tenantId,
    kind: kind.value,
    evidenceId: evidenceId.value,
    changedAt: changedAt.value,
  }));
  return view(store, ready.tenantId, null, { ok: true });
}

export function recordUncertainOrder(store, input) {
  const ready = gate(store, input, ORDER_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const orderId = named(input.orderId, "order is not recorded");
  if (!orderId.ok) return fail(orderId.error, store, ready.tenantId, null);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, null);
  const existing = store.orders.find((row) => row.tenantId === ready.tenantId && row.orderId === orderId.value);
  if (existing) return view(store, ready.tenantId, null, { ok: true, idempotentReplay: true });
  store.orders.push(Object.freeze({
    tenantId: ready.tenantId,
    orderId: orderId.value,
    state: "uncertain",
    changedAt: changedAt.value,
  }));
  return view(store, ready.tenantId, null, { ok: true });
}

export function reconcileUncertainOrder(store, input) {
  const ready = gate(store, input, ORDER_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const orderId = named(input.orderId, "order is not recorded");
  if (!orderId.ok) return fail(orderId.error, store, ready.tenantId, null);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, null);
  const order = store.orders.find((row) => row.tenantId === ready.tenantId && row.orderId === orderId.value);
  if (!order) return fail("order is not recorded", store, ready.tenantId, null);
  const existing = store.reconciliations.find((row) => row.tenantId === ready.tenantId && row.orderId === orderId.value);
  if (existing) {
    return view(store, ready.tenantId, null, { ok: true, idempotentReplay: true, reconciled: true });
  }
  store.reconciliations.push(Object.freeze({
    tenantId: ready.tenantId,
    orderId: orderId.value,
    changedAt: changedAt.value,
  }));
  return view(store, ready.tenantId, null, { ok: true, reconciled: true });
}

export function stopOrderIntents(store, input) {
  const ready = gate(store, input, STOP_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, environment.value);
  if (intentsStopped(store, environment.value)) {
    return view(store, ready.tenantId, environment.value, { ok: true, idempotentReplay: true });
  }
  store.stops.push(Object.freeze({
    tenantId: ready.tenantId,
    environment: environment.value,
    stopped: true,
    changedAt: changedAt.value,
  }));
  return view(store, ready.tenantId, environment.value, { ok: true });
}

export function rollbackRelease(store, input) {
  const ready = gate(store, input, ROLLBACK_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const sourceHash = named(input.sourceHash, "prior build is not recorded");
  if (!sourceHash.ok) return fail(sourceHash.error, store, ready.tenantId, environment.value);
  const changedAt = stampOf(input.changedAt);
  if (!changedAt.ok) return fail(changedAt.error, store, ready.tenantId, environment.value);
  const manifest = manifestOf(store, environment.value, sourceHash.value);
  if (!manifest || !completeBuild(store, environment.value, sourceHash.value)) {
    return fail("prior build is not recorded", store, ready.tenantId, environment.value);
  }
  if (!intentsStopped(store, environment.value)) {
    return fail("new order intents are not stopped", store, ready.tenantId, environment.value);
  }
  if (openOrders(store, ready.tenantId)) {
    return fail("uncertain orders are not reconciled", store, ready.tenantId, environment.value);
  }
  const current = currentBuild(store, environment.value);
  if (current && current.sourceHash === sourceHash.value) {
    return view(store, ready.tenantId, environment.value, {
      ok: true,
      idempotentReplay: true,
      restored: true,
      reconciled: true,
      sourceHash: sourceHash.value,
      schemaVersion: manifest.schemaVersion,
    });
  }
  store.builds.push(Object.freeze({
    tenantId: ready.tenantId,
    environment: environment.value,
    sourceHash: manifest.sourceHash,
    schemaVersion: manifest.schemaVersion,
    changedAt: changedAt.value,
    restored: true,
  }));
  return view(store, ready.tenantId, environment.value, {
    ok: true,
    restored: true,
    reconciled: true,
    sourceHash: sourceHash.value,
    schemaVersion: manifest.schemaVersion,
  });
}

export function readReleaseRollout(store, input) {
  const ready = gate(store, input, READ_KEYS);
  if (!ready.ok) return fail(ready.error, store, null, null);
  const environment = environmentOf(input.environment);
  if (!environment.ok) return fail(environment.error, store, ready.tenantId, null);
  const current = currentBuild(store, environment.value);
  return view(store, ready.tenantId, environment.value, {
    ok: true,
    sourceHash: current ? current.sourceHash : null,
    schemaVersion: current ? current.schemaVersion : null,
  });
}
