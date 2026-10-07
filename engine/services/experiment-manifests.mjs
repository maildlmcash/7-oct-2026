// Experiment manifests for TASK 13.C.01.
// A run stores the code SHA, model, data, and feature versions, config, seed,
// run id, and output checksum. The stored manifest is frozen.
// A rerun resolves those recorded versions and does not draw a number from the seed.
// This module does not place an order.

import { createHash } from "node:crypto";

const CHECKSUM = /^[0-9a-f]{64}$/;
const REGISTER_KEYS = Object.freeze([
  "runId",
  "codeSha",
  "modelVersion",
  "dataVersion",
  "featureVersion",
  "config",
  "seed",
  "outputChecksum",
]);
const READ_KEYS = Object.freeze(["runId"]);

function fail(error) {
  return Object.freeze({ ok: false, blocked: "BLOCKED", error, manifest: null });
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

function named(value, missing) {
  if (!filled(value)) return { ok: false, error: missing };
  return { ok: true, value };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function unresolved(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    resolved: false,
    runId: null,
    codeSha: null,
    modelVersion: null,
    dataVersion: null,
    featureVersion: null,
    config: null,
    configChecksum: null,
    seed: null,
    seedUsed: null,
    outputChecksum: null,
  });
}

export function createExperimentStore() {
  return { runs: new Map() };
}

export function registerExperiment(store, input) {
  if (!store || !(store.runs instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, REGISTER_KEYS)) return fail("unsupported field");
  const runId = named(input.runId, "run is not configured");
  if (!runId.ok) return fail(runId.error);
  const codeSha = named(input.codeSha, "code SHA is not configured");
  if (!codeSha.ok) return fail(codeSha.error);
  const modelVersion = named(input.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return fail(modelVersion.error);
  const dataVersion = named(input.dataVersion, "data version is not configured");
  if (!dataVersion.ok) return fail(dataVersion.error);
  const featureVersion = named(input.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return fail(featureVersion.error);
  if (!plainObject(input.config)) return fail("config is not configured");
  const seed = named(input.seed, "seed is not configured");
  if (!seed.ok) return fail(seed.error);
  if (typeof input.outputChecksum !== "string" || !CHECKSUM.test(input.outputChecksum)) {
    return fail("output checksum is not configured");
  }
  const config = deepFreeze(structuredClone(input.config));
  const record = deepFreeze({
    runId: runId.value,
    codeSha: codeSha.value,
    modelVersion: modelVersion.value,
    dataVersion: dataVersion.value,
    featureVersion: featureVersion.value,
    config,
    configChecksum: createHash("sha256").update(canonical(config)).digest("hex"),
    seed: seed.value,
    seedUsed: false,
    outputChecksum: input.outputChecksum,
  });
  const prior = store.runs.get(record.runId);
  if (prior) {
    if (canonical(prior) !== canonical(record)) return fail("experiment is already recorded");
    return Object.freeze({ ok: true, blocked: null, error: null, manifest: prior });
  }
  store.runs.set(record.runId, record);
  return Object.freeze({ ok: true, blocked: null, error: null, manifest: record });
}

export function readExperiment(store, input) {
  if (!store || !(store.runs instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const runId = named(input.runId, "run is not configured");
  if (!runId.ok) return fail(runId.error);
  const manifest = store.runs.get(runId.value);
  if (!manifest) return fail("run is not configured");
  return Object.freeze({ ok: true, blocked: null, error: null, manifest });
}

export function resolveExperimentRerun(store, input) {
  if (!store || !(store.runs instanceof Map)) return unresolved("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return unresolved("unsupported field");
  const runId = named(input.runId, "run is not configured");
  if (!runId.ok) return unresolved(runId.error);
  const manifest = store.runs.get(runId.value);
  if (!manifest || !plainObject(manifest)) return unresolved("run is not configured");
  const codeSha = named(manifest.codeSha, "code SHA is not configured");
  if (!codeSha.ok) return unresolved(codeSha.error);
  const modelVersion = named(manifest.modelVersion, "model version is not configured");
  if (!modelVersion.ok) return unresolved(modelVersion.error);
  const dataVersion = named(manifest.dataVersion, "data version is not configured");
  if (!dataVersion.ok) return unresolved(dataVersion.error);
  const featureVersion = named(manifest.featureVersion, "feature version is not configured");
  if (!featureVersion.ok) return unresolved(featureVersion.error);
  if (!plainObject(manifest.config)) return unresolved("config is not configured");
  const seed = named(manifest.seed, "seed is not configured");
  if (!seed.ok) return unresolved(seed.error);
  if (typeof manifest.outputChecksum !== "string" || !CHECKSUM.test(manifest.outputChecksum)) {
    return unresolved("output checksum is not configured");
  }
  if (manifest.configChecksum !== createHash("sha256").update(canonical(manifest.config)).digest("hex")) {
    return unresolved("config checksum does not match");
  }
  return Object.freeze({
    ok: true,
    blocked: null,
    error: null,
    resolved: true,
    runId: manifest.runId,
    codeSha: codeSha.value,
    modelVersion: modelVersion.value,
    dataVersion: dataVersion.value,
    featureVersion: featureVersion.value,
    config: manifest.config,
    configChecksum: manifest.configChecksum,
    seed: seed.value,
    seedUsed: false,
    outputChecksum: manifest.outputChecksum,
  });
}
