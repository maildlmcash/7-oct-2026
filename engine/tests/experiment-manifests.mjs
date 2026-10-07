import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createExperimentStore,
  readExperiment,
  registerExperiment,
  resolveExperimentRerun,
} from "../services/experiment-manifests.mjs";
import * as experiments from "../services/experiment-manifests.mjs";

const CODE = "a67aca9027167448f60de9abebca9e94cf43d325";
const OUTPUT = createHash("sha256").update("fixture-output").digest("hex");

function manifest(extra) {
  return {
    runId: "fixture-run",
    codeSha: CODE,
    modelVersion: "fixture-model",
    dataVersion: "fixture-data",
    featureVersion: "fixture-features",
    config: { horizon: "fixture-horizon" },
    seed: "fixture-seed",
    outputChecksum: OUTPUT,
    ...extra,
  };
}

test("an experiment keeps the code SHA, versions, seed, and output checksum", () => {
  const store = createExperimentStore();
  const registered = registerExperiment(store, manifest());
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.manifest.codeSha, CODE);
  assert.equal(registered.manifest.modelVersion, "fixture-model");
  assert.equal(registered.manifest.dataVersion, "fixture-data");
  assert.equal(registered.manifest.featureVersion, "fixture-features");
  assert.equal(registered.manifest.seed, "fixture-seed");
  assert.equal(registered.manifest.seedUsed, false);
  assert.equal(registered.manifest.outputChecksum, OUTPUT);
  assert.match(registered.manifest.configChecksum, /^[0-9a-f]{64}$/);
  const again = registerExperiment(store, manifest());
  assert.deepEqual(again.manifest, registered.manifest);
  const read = readExperiment(store, { runId: "fixture-run" });
  assert.deepEqual(read.manifest, registered.manifest);
  assert.equal(store.runs.size, 1);
  const source = manifest({
    runId: "fixture-run-nested",
    config: { horizon: "fixture-horizon", nested: { lookback: "fixture-lookback" } },
  });
  const nested = registerExperiment(store, source);
  assert.equal(nested.ok, true, nested.error);
  source.config.horizon = "changed";
  source.config.nested.lookback = "changed";
  assert.equal(nested.manifest.config.horizon, "fixture-horizon");
  assert.equal(nested.manifest.config.nested.lookback, "fixture-lookback");
  assert.equal(Object.isFrozen(nested.manifest), true);
  assert.equal(Object.isFrozen(nested.manifest.config), true);
  assert.equal(Object.isFrozen(nested.manifest.config.nested), true);
  assert.throws(() => {
    nested.manifest.seed = "fixture-seed-2";
  }, TypeError);
  const resolved = resolveExperimentRerun(store, { runId: "fixture-run" });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.codeSha, CODE);
  assert.equal(resolved.modelVersion, "fixture-model");
  assert.equal(resolved.dataVersion, "fixture-data");
  assert.equal(resolved.featureVersion, "fixture-features");
  assert.equal(resolved.seed, "fixture-seed");
  assert.equal(resolved.seedUsed, false);
  assert.equal(resolved.outputChecksum, OUTPUT);
  assert.deepEqual(resolved.config, registered.manifest.config);
  assert.equal(resolved.configChecksum, registered.manifest.configChecksum);
});

test("a missing version and a changed run stay blocked", () => {
  const store = createExperimentStore();
  const missing = registerExperiment(store, manifest({ featureVersion: " " }));
  assert.equal(missing.blocked, "BLOCKED");
  assert.equal(missing.error, "feature version is not configured");
  assert.equal(missing.manifest, null);
  assert.equal(readExperiment(store, { runId: "fixture-run" }).error, "run is not configured");
  const badChecksum = registerExperiment(store, manifest({ outputChecksum: "abcd" }));
  assert.equal(badChecksum.error, "output checksum is not configured");
  assert.equal(JSON.stringify(badChecksum).includes("abcd"), false);
  registerExperiment(store, manifest());
  const changed = registerExperiment(store, manifest({ seed: "fixture-seed-2" }));
  assert.equal(changed.error, "experiment is already recorded");
  assert.equal(readExperiment(store, { runId: "fixture-run" }).manifest.seed, "fixture-seed");
  assert.equal(resolveExperimentRerun(store, { runId: "fixture-run" }).seed, "fixture-seed");
  const missingRun = resolveExperimentRerun(store, { runId: "fixture-missing" });
  assert.equal(missingRun.blocked, "BLOCKED");
  assert.equal(missingRun.error, "run is not configured");
  assert.equal(missingRun.resolved, false);
  assert.equal(missingRun.modelVersion, null);
  store.runs.set("fixture-broken", Object.freeze({
    runId: "fixture-broken",
    codeSha: CODE,
    modelVersion: " ",
    dataVersion: "fixture-data",
    featureVersion: "fixture-features",
    config: { horizon: "fixture-horizon" },
    configChecksum: "ab".repeat(32),
    seed: "fixture-seed",
    seedUsed: false,
    outputChecksum: OUTPUT,
  }));
  const broken = resolveExperimentRerun(store, { runId: "fixture-broken" });
  assert.equal(broken.resolved, false);
  assert.equal(broken.error, "model version is not configured");
  assert.equal(broken.codeSha, null);
  assert.equal(JSON.stringify(broken).includes(CODE), false);
  store.runs.set("fixture-checksum", Object.freeze({
    runId: "fixture-checksum",
    codeSha: CODE,
    modelVersion: "fixture-model",
    dataVersion: "fixture-data",
    featureVersion: "fixture-features",
    config: Object.freeze({ horizon: "fixture-horizon" }),
    configChecksum: "ab".repeat(32),
    seed: "fixture-seed",
    seedUsed: false,
    outputChecksum: OUTPUT,
  }));
  const unmatched = resolveExperimentRerun(store, { runId: "fixture-checksum" });
  assert.equal(unmatched.resolved, false);
  assert.equal(unmatched.error, "config checksum does not match");
  assert.equal(unmatched.featureVersion, null);
});

test("the experiment export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(experiments).sort(), [
    "createExperimentStore",
    "readExperiment",
    "registerExperiment",
    "resolveExperimentRerun",
  ]);
  const source = readFileSync(new URL("../services/experiment-manifests.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
