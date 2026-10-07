import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createExperimentStore, registerExperiment } from "../services/experiment-manifests.mjs";
import {
  LEAKAGE_CHECKLIST,
  LEAKAGE_LIMITATIONS,
  exportLeakageReview,
} from "../services/leakage-review.mjs";
import * as leakage from "../services/leakage-review.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Lag threshold 1000 is a caller fixture. The source names no max event lag.
// The label offset, the run id, and the versions are fixtures and are NOT IN SOURCE.
const TIME = 1499865549590;
const LAG = 1000;
const CODE = "a67aca9027167448f60de9abebca9e94cf43d325";
const OUTPUT = createHash("sha256").update("fixture-output").digest("hex");
const REVIEWER = { id: "fixture-reviewer", role: "Admin", tenantId: "fixture-tenant" };

function store() {
  const runs = createExperimentStore();
  const registered = registerExperiment(runs, {
    runId: "fixture-run",
    codeSha: CODE,
    modelVersion: "fixture-model",
    dataVersion: "fixture-data",
    featureVersion: "fixture-features",
    config: { horizon: "fixture-horizon" },
    seed: "fixture-seed",
    outputChecksum: OUTPUT,
  });
  assert.equal(registered.ok, true, registered.error);
  return { runs, registered };
}

function feature(at) {
  return {
    name: "spread",
    source: "fixture-source",
    eventTime: at,
    window: { from: at, to: at },
    quality: { healthy: true, reason: null },
  };
}

function review(extra = {}) {
  const { row: rowExtra, ...rest } = extra;
  return {
    actor: { ...REVIEWER },
    evidence: "fixture-evidence",
    runId: "fixture-run",
    universe: [{ id: "fixture-series", survived: true }],
    candidates: ["fixture-series"],
    rows: [{
      id: "fixture-series",
      cutoff: TIME,
      receiveTime: TIME,
      lagThreshold: LAG,
      features: [feature(TIME)],
      label: { outcomeTime: TIME + 2 },
      ...rowExtra,
    }],
    ...rest,
  };
}

test("a clean review exports the reviewer, the evidence, and the limitations", () => {
  const bound = store();
  const input = review();
  const exported = exportLeakageReview(bound.runs, input);
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.blocked, null);
  assert.equal(exported.caught, false);
  assert.deepEqual(exported.reviewer, REVIEWER);
  assert.equal(exported.evidence, "fixture-evidence");
  assert.deepEqual(exported.limitations, [...LEAKAGE_LIMITATIONS]);
  assert.deepEqual(exported.checklist.map((item) => item.kind), [...LEAKAGE_CHECKLIST]);
  for (const item of exported.checklist) {
    assert.equal(item.caught, false);
    assert.equal(item.check, null);
  }
  assert.equal(exported.result.codeSha, CODE);
  assert.equal(exported.result.modelVersion, "fixture-model");
  assert.equal(exported.result.dataVersion, "fixture-data");
  assert.equal(exported.result.featureVersion, "fixture-features");
  assert.equal(exported.result.configChecksum, bound.registered.manifest.configChecksum);
  assert.equal(exported.result.outputChecksum, OUTPUT);
  assert.equal(exported.result.seedUsed, false);
  assert.equal(exported.result.sampleSize, 1);
  assert.deepEqual(exported.result.rows, ["fixture-series"]);
  input.rows[0].label.outcomeTime = TIME;
  input.actor.id = "fixture-reviewer-2";
  assert.equal(exported.result.rows[0], "fixture-series");
  assert.equal(exported.reviewer.id, "fixture-reviewer");
  assert.equal(Object.isFrozen(exported), true);
  assert.equal(Object.isFrozen(exported.checklist), true);
  assert.equal(Object.isFrozen(exported.checklist[0]), true);
  assert.equal(Object.isFrozen(exported.result), true);
  assert.throws(() => {
    exported.evidence = "fixture-evidence-2";
  }, TypeError);
  const again = exportLeakageReview(bound.runs, review());
  assert.deepEqual(again, exported);
  assert.equal(bound.runs.runs.size, 1);
});

test("a deliberately leaked fixture is caught and a missing review stays blocked", () => {
  const bound = store();
  const ahead = exportLeakageReview(bound.runs, review({
    row: {
      receiveTime: TIME + 3,
      features: [feature(TIME + 3)],
    },
  }));
  assert.equal(ahead.ok, false);
  assert.equal(ahead.blocked, "BLOCKED");
  assert.equal(ahead.caught, true);
  assert.equal(ahead.error, "lookahead window");
  assert.deepEqual(ahead.reviewer, REVIEWER);
  assert.equal(ahead.evidence, "fixture-evidence");
  assert.deepEqual(ahead.limitations, [...LEAKAGE_LIMITATIONS]);
  assert.equal(ahead.checklist[0].kind, "lookahead");
  assert.equal(ahead.checklist[0].caught, true);
  assert.equal(ahead.checklist[0].check, "lookahead window");
  assert.equal(ahead.checklist[0].feature, "spread");
  assert.equal(ahead.checklist[0].source, "fixture-source");
  assert.equal(ahead.checklist[3].caught, false);
  assert.equal(ahead.result.codeSha, CODE);
  assert.deepEqual(ahead.result.rows, ["fixture-series"]);
  assert.equal(ahead.result.seedUsed, false);

  const survived = exportLeakageReview(bound.runs, review({
    universe: [
      { id: "fixture-series", survived: true },
      { id: "fixture-dropped", survived: false },
    ],
  }));
  assert.equal(survived.caught, true);
  assert.equal(survived.error, "survivorship");
  assert.equal(survived.checklist[1].caught, true);
  assert.equal(survived.checklist[1].id, "fixture-dropped");
  assert.equal(survived.checklist[0].caught, false);
  assert.equal(survived.checklist[2].caught, false);
  assert.equal(survived.evidence, "fixture-evidence");
  assert.deepEqual(survived.reviewer, REVIEWER);

  const selected = exportLeakageReview(bound.runs, review({
    candidates: ["fixture-series", "fixture-omitted"],
  }));
  assert.equal(selected.caught, true);
  assert.equal(selected.error, "selection");
  assert.equal(selected.checklist[2].id, "fixture-omitted");
  assert.equal(selected.checklist[1].caught, false);
  assert.equal(selected.evidence, "fixture-evidence");

  const labeled = exportLeakageReview(bound.runs, review({
    row: {
      receiveTime: TIME + 1,
      features: [feature(TIME + 1)],
    },
  }));
  assert.equal(labeled.caught, true);
  assert.equal(labeled.error, "label leakage");
  assert.equal(labeled.checklist[3].feature, "spread");
  assert.equal(labeled.checklist[3].source, "fixture-source");
  assert.equal(labeled.checklist[0].caught, false);
  assert.equal(JSON.stringify(labeled).includes("lookahead window"), false);
  assert.equal(labeled.reviewer.id, "fixture-reviewer");
  assert.equal(labeled.evidence, "fixture-evidence");

  const present = exportLeakageReview(bound.runs, review({
    row: { label: { outcomeTime: TIME } },
  }));
  assert.equal(present.caught, true);
  assert.equal(present.error, "label leakage");
  assert.equal(present.checklist[3].feature, null);
  assert.equal(present.checklist[0].caught, false);

  const late = exportLeakageReview(bound.runs, review({
    row: { receiveTime: TIME + LAG + 1 },
  }));
  assert.equal(late.ok, false);
  assert.equal(late.caught, false);
  assert.equal(late.error, "late event");
  assert.equal(late.evidence, "fixture-evidence");
  assert.equal(late.checklist[0].caught, false);

  const missingReviewer = exportLeakageReview(bound.runs, review({ actor: null }));
  assert.equal(missingReviewer.error, "reviewer is not configured");
  assert.equal(missingReviewer.reviewer, null);
  assert.equal(missingReviewer.evidence, null);
  assert.equal(missingReviewer.checklist, null);

  const customer = exportLeakageReview(bound.runs, review({
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
  }));
  assert.equal(customer.error, "role scope denied");
  assert.equal(customer.reviewer, null);
  assert.equal(customer.checklist, null);

  const secret = exportLeakageReview(bound.runs, review({ evidence: "bearer fixture-token" }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(secret.evidence, null);
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);

  const supplied = exportLeakageReview(bound.runs, review({ checklist: "fixture-clear" }));
  assert.equal(supplied.error, "unsupported field");
  assert.equal(supplied.checklist, null);
  assert.equal(JSON.stringify(supplied).includes("fixture-clear"), false);

  const missingRun = exportLeakageReview(bound.runs, review({ runId: "fixture-missing" }));
  assert.equal(missingRun.error, "run is not configured");
  assert.equal(missingRun.result, null);
  assert.equal(JSON.stringify(missingRun).includes(CODE), false);
});

test("the leakage export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(leakage).sort(), [
    "LEAKAGE_CHECKLIST",
    "LEAKAGE_LIMITATIONS",
    "exportLeakageReview",
  ]);
  const source = readFileSync(new URL("../services/leakage-review.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("checkFeatureQuality"), true);
  assert.equal(source.includes("resolveExperimentRerun"), true);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
