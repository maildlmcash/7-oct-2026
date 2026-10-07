import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { createFindingLog, recordSignal } from "../services/finding-normalizer.mjs";
import { triageFinding } from "../services/finding-triage.mjs";
import {
  FUTURES_LIVE_LOCK_LIMITATIONS,
  checkLiveFutures,
  createLiveFuturesLock,
  recordLiveFuturesApproval,
} from "../services/futures-live-lock.mjs";
import * as lockApi from "../services/futures-live-lock.mjs";
import {
  createReleaseGate,
  evaluateReleaseGate,
  recordReleaseRerun,
} from "../services/release-gate.mjs";

const tenantId = "fixture-tenant";
const requestId = "11111111-1111-4111-8111-111111111111";
const buildSha = "deadbeef";
const evidence = "file://docs/evidence/remediation.txt";
// The source names no numeric release threshold. This fixture selects existing failure statuses.
const threshold = { blockingStatuses: ["FAIL", "BLOCKED"] };
const REQUESTER = { id: "fixture-requester", role: "Admin", tenantId };
const APPROVER_A = { id: "fixture-approver-a", role: "Admin", tenantId };
const APPROVER_B = { id: "fixture-approver-b", role: "Admin", tenantId };
const RELEASE_ACTOR = { id: "fixture-release-admin", role: "Admin", tenantId };

function quiet(result) {
  const body = JSON.stringify(result);
  assert.equal(body.includes("ON"), false);
  assert.equal(body.includes("fixture-credential"), false);
  assert.equal(body.includes("fixture-token"), false);
  assert.equal(body.includes("fixture-spot-order"), false);
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveEnabled, false);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.credentialStored, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.configSource, "health");
  assert.equal(result.environmentHonored, false);
  assert.equal(result.liveTrading, health.liveTrading);
  assert.equal(result.liveOrdersLocked, health.liveOrdersLocked);
  return result;
}

function passedRelease() {
  const gate = createReleaseGate();
  const log = createFindingLog();
  const recorded = recordSignal(log, {
    source: "page-health",
    seenAt: "2026-10-07T00:00:00Z",
    tenantId,
    event: {
      routeViewId: "/api/view-state",
      viewId: "Dashboard",
      httpStatus: 500,
      requestId,
      buildSha,
    },
  });
  const fingerprint = recorded.finding.fingerprint;
  triageFinding(log, {
    actor: RELEASE_ACTOR,
    tenantId,
    fingerprint,
    status: "PASS",
    checklistItemId: "item-1",
    owner: "ada",
    evidence,
  });
  const waiting = evaluateReleaseGate(gate, {
    actor: RELEASE_ACTOR,
    tenantId,
    findings: log.findings,
    threshold,
    changedAt: "2026-10-07T02:00:00Z",
  });
  assert.equal(waiting.reason, "rerun is required");
  recordReleaseRerun(gate, {
    actor: RELEASE_ACTOR,
    tenantId,
    fingerprint,
    result: "PASS",
    evidence,
    at: "2026-10-07T03:00:00Z",
  });
  const passed = evaluateReleaseGate(gate, {
    actor: RELEASE_ACTOR,
    tenantId,
    findings: log.findings,
    threshold,
    changedAt: "2026-10-07T03:00:00Z",
    deploy: true,
  });
  assert.equal(passed.reason, "release gate passed");
  assert.equal(passed.edited, false);
  assert.equal(passed.deployed, false);
  return gate;
}

function approvePair(store) {
  const first = recordLiveFuturesApproval(store, {
    actor: APPROVER_A,
    tenantId,
    changedAt: "2026-10-07T01:00:00Z",
  });
  const second = recordLiveFuturesApproval(store, {
    actor: APPROVER_B,
    tenantId,
    changedAt: "2026-10-07T01:01:00Z",
  });
  assert.equal(first.ok, true);
  assert.equal(second.approvalCount, 2);
  return store;
}

test("environment default and a UI override cannot enable live futures", () => {
  const store = createLiveFuturesLock();
  const omitted = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "configuration",
  }));
  assert.equal(omitted.ok, true);
  assert.equal(omitted.error, null);
  assert.equal(omitted.kind, "configuration");
  assert.equal(store.approvals.length, 0);

  const matching = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "configuration",
    environment: { LIVE_TRADING: "OFF", LIVE_ORDERS_LOCKED: "true" },
    liveTrading: "OFF",
    liveOrdersLocked: true,
  }));
  assert.equal(matching.ok, true);
  assert.equal(matching.environmentHonored, false);

  const hostile = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "configuration",
    environment: { LIVE_TRADING: "ON", LIVE_ORDERS_LOCKED: "false" },
    liveTrading: "ON",
    liveOrdersLocked: false,
  }));
  assert.equal(hostile.ok, false);
  assert.equal(hostile.error, "live mode cannot be enabled");
  assert.equal(hostile.blocked, "BLOCKED");
  assert.equal(store.approvals.length, 0);

  const previousTrading = process.env.LIVE_TRADING;
  const previousLocked = process.env.LIVE_ORDERS_LOCKED;
  process.env.LIVE_TRADING = "ON";
  process.env.LIVE_ORDERS_LOCKED = "false";
  try {
    const fromProcess = quiet(checkLiveFutures(store, {
      actor: REQUESTER,
      tenantId,
      kind: "configuration",
    }));
    assert.equal(fromProcess.ok, true);
    assert.equal(fromProcess.liveEnabled, false);
  } finally {
    if (previousTrading === undefined) delete process.env.LIVE_TRADING;
    else process.env.LIVE_TRADING = previousTrading;
    if (previousLocked === undefined) delete process.env.LIVE_ORDERS_LOCKED;
    else process.env.LIVE_ORDERS_LOCKED = previousLocked;
  }

  for (const path of ["../.env.local.example", "../.env.test.example"]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(text.includes("LIVE_TRADING=OFF"), true);
    assert.equal(text.includes("LIVE_ORDERS_LOCKED=true"), true);
    assert.equal(text.includes("LIVE_TRADING=ON"), false);
    assert.equal(text.includes("LIVE_ORDERS_LOCKED=false"), false);
  }
  assert.equal(store.approvals.length, 0);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});

test("live futures orders stay blocked until separate approval and a release gate are recorded", () => {
  const store = createLiveFuturesLock();
  const release = passedRelease();
  const base = {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    idempotencyKey: "fixture-key-order",
    order: { id: "fixture-order" },
    release,
  };

  const none = quiet(checkLiveFutures(store, base));
  assert.equal(none.error, "human approval is not recorded");
  assert.equal(store.approvals.length, 0);

  const first = recordLiveFuturesApproval(store, {
    actor: APPROVER_A,
    tenantId,
    changedAt: "2026-10-07T01:00:00Z",
  });
  assert.equal(first.ok, true);
  assert.equal(first.idempotentReplay, false);
  const replay = recordLiveFuturesApproval(store, {
    actor: APPROVER_A,
    tenantId,
    changedAt: "2026-10-07T01:00:00Z",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.approvals.length, 1);
  const again = quiet(recordLiveFuturesApproval(store, {
    actor: APPROVER_A,
    tenantId,
    changedAt: "2026-10-07T01:02:00Z",
  }));
  assert.equal(again.error, "approval is already recorded");
  assert.equal(store.approvals.length, 1);

  const one = quiet(checkLiveFutures(store, base));
  assert.equal(one.error, "human approval is not separate");

  recordLiveFuturesApproval(store, {
    actor: APPROVER_B,
    tenantId,
    changedAt: "2026-10-07T01:01:00Z",
  });
  assert.equal(store.approvals.length, 2);
  const third = quiet(recordLiveFuturesApproval(store, {
    actor: { id: "fixture-approver-c", role: "Admin", tenantId },
    tenantId,
    changedAt: "2026-10-07T01:03:00Z",
  }));
  assert.equal(third.error, "approval is already recorded");
  assert.equal(store.approvals.length, 2);

  const maker = quiet(checkLiveFutures(store, {
    ...base,
    actor: APPROVER_A,
  }));
  assert.equal(maker.error, "maker cannot approve");

  const missingRelease = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    order: { id: "fixture-order" },
  }));
  assert.equal(missingRelease.error, "release gate is not recorded");

  const blockedGate = createReleaseGate();
  const blockedAudit = evaluateReleaseGate(blockedGate, {
    actor: RELEASE_ACTOR,
    tenantId,
    findings: [{ tenantId, status: "FAIL", fingerprint: "fixture-open" }],
    threshold,
    changedAt: "2026-10-07T02:00:00Z",
    deploy: true,
  });
  assert.equal(blockedAudit.reason, "critical checklist failure");
  const blocked = quiet(checkLiveFutures(store, { ...base, release: blockedGate }));
  assert.equal(blocked.error, "release gate is blocked");

  const foreign = createReleaseGate();
  foreign.audits.push(Object.freeze({
    tenantId: "fixture-other",
    action: "release-gate",
    result: "passed",
    reason: "release gate passed",
    edited: false,
    deployed: false,
  }));
  const otherTenant = quiet(checkLiveFutures(store, { ...base, release: foreign }));
  assert.equal(otherTenant.error, "release gate is not recorded");

  const edited = passedRelease();
  edited.audits.push(Object.freeze({
    tenantId,
    action: "release-gate",
    result: "passed",
    reason: "release gate passed",
    edited: true,
    deployed: false,
  }));
  const editedResult = quiet(checkLiveFutures(store, { ...base, release: edited }));
  assert.equal(editedResult.error, "release gate is blocked");

  store.approvals.push(Object.freeze({
    tenantId,
    approver: APPROVER_A.id,
    changedAt: "2026-10-07T01:04:00Z",
  }));
  const distinct = quiet(checkLiveFutures(store, base));
  assert.equal(distinct.error, "approvers are not distinct");
  store.approvals.pop();
  assert.equal(store.approvals.length, 2);

  const customer = quiet(checkLiveFutures(store, {
    ...base,
    actor: { id: "fixture-customer", role: "Customer", tenantId },
  }));
  assert.equal(customer.error, "role scope denied");
  const customerApproval = quiet(recordLiveFuturesApproval(store, {
    actor: { id: "fixture-customer", role: "Customer", tenantId },
    tenantId,
    changedAt: "2026-10-07T01:05:00Z",
  }));
  assert.equal(customerApproval.error, "role scope denied");
  const cross = quiet(recordLiveFuturesApproval(store, {
    actor: { id: "fixture-other-admin", role: "Admin", tenantId: "fixture-other" },
    tenantId,
    changedAt: "2026-10-07T01:06:00Z",
  }));
  assert.equal(cross.error, "role scope denied");
  assert.equal(store.approvals.length, 2);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});

test("recorded approval and a passed release gate still do not unlock live futures", () => {
  const store = createLiveFuturesLock();
  approvePair(store);
  const release = passedRelease();
  const auditsBefore = release.audits.length;

  const order = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    idempotencyKey: "fixture-key-order",
    order: { id: "fixture-order" },
    release,
    environment: { LIVE_TRADING: "ON", LIVE_ORDERS_LOCKED: "false" },
    liveTrading: "ON",
    liveOrdersLocked: false,
  }));
  assert.equal(order.ok, false);
  assert.equal(order.error, "live orders are locked");
  assert.equal(order.releaseRecorded, true);
  assert.equal(order.approvalCount, 2);
  assert.equal(release.audits.length, auditsBefore);
  assert.equal(store.approvals.length, 2);
  assert.equal("orders" in store, false);

  const repeated = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    idempotencyKey: "fixture-key-order",
    order: { id: "fixture-order" },
    release,
  }));
  assert.equal(repeated.error, "live orders are locked");
  assert.equal(store.approvals.length, 2);

  const credential = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "credentials",
    product: "futures",
    credential: "fixture-credential",
    release,
  }));
  assert.equal(credential.error, "live credentials are not allowed");
  assert.equal(credential.releaseRecorded, true);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);

  const apiKey = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "credentials",
    product: "futures",
    apiKey: "fixture-credential",
    release,
  }));
  assert.equal(apiKey.error, "live credentials are not allowed");

  const bearer = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    order: { id: "bearer fixture-token" },
    release,
  }));
  assert.equal(bearer.error, "secret value is not allowed");

  const spot = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "spot",
    order: { id: "fixture-spot-order" },
    release,
    liveTrading: "ON",
  }));
  assert.equal(spot.error, "product is not supported");
  assert.equal(store.approvals.length, 2);

  const relocked = passedRelease();
  const later = evaluateReleaseGate(relocked, {
    actor: RELEASE_ACTOR,
    tenantId,
    findings: [{ tenantId, status: "FAIL", fingerprint: "fixture-later" }],
    threshold,
    changedAt: "2026-10-07T04:00:00Z",
    deploy: true,
  });
  assert.equal(later.reason, "critical checklist failure");
  assert.equal(later.deployed, false);
  const after = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    order: { id: "fixture-order" },
    release: relocked,
  }));
  assert.equal(after.error, "release gate is blocked");
  assert.equal(after.liveOrderSubmitted, false);

  const unknown = quiet(checkLiveFutures(store, {
    actor: REQUESTER,
    tenantId,
    kind: "order",
    product: "futures",
    order: { id: "fixture-order" },
    release,
    clock: "60000",
  }));
  assert.equal(unknown.error, "unsupported field");
  assert.equal(store.approvals.length, 2);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/futures-live-lock.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("appendFuturesPaperOrder"), false);
  assert.equal(source.includes("checkFuturesPreTrade"), false);
  assert.equal(source.includes("evaluateReleaseGate"), false);
  assert.equal(source.includes("recordReleaseRerun"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.equal(source.includes("health.liveTrading"), true);
  assert.equal(source.includes("canEditChecklist"), true);
  assert.deepEqual(Object.keys(lockApi).sort(), [
    "FUTURES_LIVE_LOCK_LIMITATIONS",
    "checkLiveFutures",
    "createLiveFuturesLock",
    "recordLiveFuturesApproval",
  ]);
  assert.equal(FUTURES_LIVE_LOCK_LIMITATIONS.includes("a 28-day paper count is NOT IN SOURCE"), true);
  assert.equal(FUTURES_LIVE_LOCK_LIMITATIONS.includes("a 200-outcome count is NOT IN SOURCE"), true);
});
