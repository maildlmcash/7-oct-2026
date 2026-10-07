import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  CLOSE_ROLES,
  CLOSE_TENANTS,
  DEPLOYMENT,
  SUPPORTED_VIEWPORTS,
  THREAT_REVIEW,
  THREAT_SURFACES,
  VISIBLE_LIVE_LABELS,
  attestPhase1Close,
  evaluatePhase1Close,
} from "../services/phase-gates/phase-1-close.mjs";

const actor = { role: "Admin", tenantId: "desk" };
const changedAt = "2026-10-07T00:00:00.000Z";

function deniedRows() {
  const rows = [];
  for (const role of CLOSE_ROLES) {
    for (const tenantId of CLOSE_TENANTS) {
      rows.push({ role, tenantId, decision: "denied", capability: "trade" });
    }
  }
  return rows;
}

function passingThreat() {
  const review = {};
  for (const surface of THREAT_SURFACES) {
    review[surface] = { reviewed: true, residual: "no open residual on this fixture", blocksP2: false };
  }
  return review;
}

function passingLabels() {
  return [
    { id: "fixture-status", text: "LIVE", kind: "status", source: "fixture-source", lastSeen: changedAt, verifiedLive: false },
    { id: "fixture-lock", text: "LIVE ORDERS LOCKED", kind: "lock", source: "apps/web/health.mjs", lastSeen: null, notObservation: true, verifiedLive: false },
  ];
}

function passingInput(overrides = {}) {
  return {
    actor,
    useInspectedLabels: false,
    useInspectedThreat: false,
    browserMatrix: { status: "PASS", viewports: SUPPORTED_VIEWPORTS, failures: [] },
    apiAuthorization: { status: "PASS", rows: deniedRows() },
    accessibility: { status: "PASS", violations: 0, roles: CLOSE_ROLES, tenants: CLOSE_TENANTS },
    security: { status: "PASS", critical: 0, high: 0, findings: [] },
    threatModel: passingThreat(),
    liveLabels: passingLabels(),
    lighthouse: { measured: true, source: "fixture lighthouse", lcp: 1, inp: 1, cls: 0, capturedAt: changedAt },
    ...overrides,
  };
}

test("phase 1 closeout fails closed and does not activate phase 2", async () => {
  const source = await readFile(new URL("../services/phase-gates/phase-1-close.mjs", import.meta.url), "utf8");
  const adr = await readFile(resolve(import.meta.dirname, "../docs/adr/0012-phase-1-close.md"), "utf8");
  assert.equal(source.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(adr.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(DEPLOYMENT.liveTrading, "OFF");
  assert.equal(DEPLOYMENT.liveOrdersLocked, true);
  assert.equal(DEPLOYMENT.walletAccess, false);
  assert.equal(THREAT_SURFACES.length, 5);
  assert.equal(THREAT_REVIEW.auth.blocksP2, false);
  assert.equal(VISIBLE_LIVE_LABELS.some((label) => label.kind === "status" && label.lastSeen === null), false);
  assert.equal(VISIBLE_LIVE_LABELS.filter((label) => label.kind === "status").length, 2);

  const empty = evaluatePhase1Close({ actor });
  assert.equal(empty.result, "BLOCKED");
  assert.equal(empty.p2Activation, false);
  assert.equal(empty.firstFailure.check, "browserMatrix");
  assert.equal(empty.deployed, false);
  assert.equal(empty.liveOrdersUnlocked, false);

  const matrixFail = evaluatePhase1Close(passingInput({
    useInspectedLabels: true,
    useInspectedThreat: true,
    browserMatrix: {
      status: "FAIL",
      viewports: SUPPORTED_VIEWPORTS,
      failures: [{ test: "apps/web/tests/layout.spec.ts", message: "heading BTCUSDT · Top of book was not found" }],
    },
    apiAuthorization: { status: "NOT_RUN" },
    accessibility: { status: "NOT_MEASURED" },
    security: { status: "FAIL", critical: 0, high: 1, findings: [{ id: "GHSA-example" }] },
    lighthouse: { measured: false },
  }));
  assert.equal(matrixFail.result, "FAIL");
  assert.equal(matrixFail.p2Activation, false);
  assert.equal(matrixFail.firstFailure.check, "browserMatrix");
  assert.match(matrixFail.firstFailure.test, /layout\.spec\.ts/);
  assert.equal(matrixFail.alsoUnresolved.some((item) => item.check === "liveLabels"), false);
  assert.equal(matrixFail.alsoUnresolved.some((item) => item.check === "security"), true);
  assert.equal(matrixFail.deployment.liveTrading, "OFF");

  const liveGap = evaluatePhase1Close(passingInput({
    liveLabels: [{ id: "bare", text: "LIVE", kind: "status", source: "nearby socket url", lastSeen: "12s" }],
  }));
  assert.equal(liveGap.result, "BLOCKED");
  assert.equal(liveGap.p2Activation, false);
  assert.match(liveGap.reason, /last-seen/);

  const high = evaluatePhase1Close(passingInput({
    security: { status: "FAIL", critical: 0, high: 1, findings: [{ id: "GHSA-7mvr-c777-76hp" }] },
  }));
  assert.equal(high.result, "FAIL");
  assert.equal(high.p2Activation, false);
  assert.equal(high.firstFailure.check, "security");

  const customer = evaluatePhase1Close(passingInput({ actor: { role: "Customer", tenantId: "desk" } }));
  assert.equal(customer.ok, false);
  assert.equal(customer.error, "role scope denied");
  assert.equal(customer.p2Activation, false);

  const forged = evaluatePhase1Close(passingInput({ liveTrading: "ON", walletAccess: true }));
  assert.equal(forged.ok, false);
  assert.equal(forged.error, "live orders and wallet access stay off");

  const secret = evaluatePhase1Close(passingInput({ note: "bearer abc" }));
  assert.equal(secret.ok, false);
  assert.equal(secret.error, "secret value is not allowed");

  const passed = evaluatePhase1Close(passingInput());
  assert.equal(passed.result, "PASS");
  assert.equal(passed.p2Activation, true);
  assert.equal(passed.deployment.liveOrdersLocked, true);
  assert.equal(passed.liveOrdersUnlocked, false);
  assert.equal(passed.deployed, false);

  const signed = attestPhase1Close(passingInput(), changedAt);
  assert.equal(signed.method.includes("no private key"), true);
  assert.equal(Object.hasOwn(signed, "privateKey"), false);
  assert.equal(signed.contentChecksum.length, 64);
  assert.equal(signed.edited, false);
  assert.equal(signed.deployed, false);
});

test("recorded phase 1 gate matches the measured closeout and keeps orders locked", async () => {
  const evidence = resolve(import.meta.dirname, "../docs/architecture/evidence/1-d-3");
  const input = JSON.parse(await readFile(resolve(evidence, "gate-input.json"), "utf8"));
  const signedOnDisk = JSON.parse(await readFile(resolve(evidence, "signed-gate.json"), "utf8"));
  const checklist = await readFile(resolve(import.meta.dirname, "../docs/checklists/phase-1.md"), "utf8");
  const bundle = await readFile(resolve(evidence, "test-bundle.md"), "utf8");
  const threat = await readFile(resolve(evidence, "threat-model-review.md"), "utf8");
  const vitals = await readFile(resolve(evidence, "lighthouse-web-vitals.md"), "utf8");
  const live = await readFile(resolve(evidence, "live-label-review.md"), "utf8");
  const health = await readFile(resolve(import.meta.dirname, "../apps/web/health.mjs"), "utf8");
  const decision = evaluatePhase1Close(input);
  const signed = attestPhase1Close(input, input.changedAt);

  assert.equal(decision.result, "PASS");
  assert.equal(decision.p2Activation, true);
  assert.equal(decision.firstFailure, null);
  assert.equal(decision.alsoUnresolved.length, 0);
  assert.equal(decision.deployment.liveTrading, "OFF");
  assert.equal(decision.deployment.liveOrdersLocked, true);
  assert.equal(decision.liveOrdersUnlocked, false);
  assert.deepEqual(signed, signedOnDisk);
  assert.equal(signed.p2Activation, true);
  assert.equal(signed.deployed, false);
  assert.equal(signed.edited, false);
  assert.match(health, /liveTrading: "OFF"/);
  assert.match(health, /liveOrdersLocked: true/);
  assert.match(checklist, /^PASS$/m);
  assert.match(checklist, /p2Activation: true/);
  assert.match(checklist, /does not mark phase 1 complete/);
  assert.match(checklist, /BTCUSDT · Top of book/);
  assert.match(checklist, /GHSA-7mvr-c777-76hp/);
  assert.match(bundle, /6 passed/);
  assert.match(threat, /not a grant/);
  assert.match(vitals, /3116\.20595/);
  assert.match(vitals, /61\.435/);
  assert.equal(vitals.includes("LCP | 2"), false);
  assert.match(live, /not verified live/);
  for (const label of VISIBLE_LIVE_LABELS.filter((item) => item.kind === "status")) {
    assert.match(label.lastSeen, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    assert.equal(live.includes(label.id), true);
    assert.equal(live.includes(label.lastSeen), true);
  }
});
