import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { PERMISSION_MATRIX, ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import {
  COMMISSION_CALCULATION_LIMITATIONS,
  calculateCommission,
} from "../services/commission-calculation.mjs";
import * as calculationApi from "../services/commission-calculation.mjs";
import {
  COMMISSION_LEDGER_LIMITATIONS,
  appendLedgerEntry,
} from "../services/commission-ledger.mjs";
import * as ledgerApi from "../services/commission-ledger.mjs";
import {
  approveCommissionPlan,
  createCommissionStore,
  defineCommissionPlan,
} from "../services/commission-plans.mjs";
import * as planApi from "../services/commission-plans.mjs";
import { registerDelegationTenant } from "../services/role-delegation.mjs";
import { authorizeShell } from "../services/shell-capabilities.mjs";

const CHANGED = "2026-10-07T00:00:00Z";
const FROM = "2026-10-08T00:00:00Z";
const TO = "2026-10-20T00:00:00Z";
const WHEN = "2026-10-09T00:00:00Z";
const SUPER = { id: "fixture-super", role: "Super Admin", tenantId: "tenant-root" };
const SUPER_2 = { id: "fixture-super-2", role: "Super Admin", tenantId: "tenant-root" };
const ADMIN = { id: "fixture-admin", role: "Admin", tenantId: "tenant-a" };
const DIST = { id: "fixture-dist", role: "Distributor", tenantId: "tenant-a-child" };
const SUPER_DIST = { id: "fixture-super-dist", role: "Super Distributor", tenantId: "tenant-root" };
const CUSTOMER = { id: "fixture-customer", role: "Customer", tenantId: "tenant-a-child" };

function quiet(result) {
  const body = JSON.stringify(result);
  assert.equal(body.includes("bearer fixture-token"), false);
  assert.equal(body.includes("fixture-credential"), false);
  assert.equal(body.includes("checklist.write"), false);
  assert.equal(body.includes("fixture-notional"), false);
  assert.equal(body.includes("fixture-unrealized"), false);
  assert.equal(body.includes("fixture-paper"), false);
  assert.equal(body.includes("half-up"), false);
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveEnabled, false);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.credentialStored, false);
  assert.equal(result.venueClient, null);
  return result;
}

function tree() {
  const store = createCommissionStore();
  for (const [tenantId, parentId] of [
    ["tenant-root", null],
    ["tenant-a", "tenant-root"],
    ["tenant-a-child", "tenant-a"],
    ["tenant-b", "tenant-root"],
  ]) {
    const row = registerDelegationTenant(store, { actor: SUPER, tenantId, parentId });
    assert.equal(row.ok, true, row.error);
  }
  return store;
}

function open() {
  const store = tree();
  store.entries = [];
  return store;
}

function putPlan(store, actor, tenantId, planId, extra = {}) {
  const defined = defineCommissionPlan(store, {
    actor,
    tenantId,
    planId,
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    basis: "realized performance fee",
    rate: "1000",
    rateCap: "4000",
    parentShare: "5000",
    childShare: "4000",
    platformShare: "1000",
    effectiveFrom: FROM,
    effectiveTo: TO,
    currency: "USDT",
    hold: true,
    refund: "reversed",
    reversal: "adjusted",
    requiredApprovers: [{ id: SUPER_2.id, role: "Super Admin" }],
    changedAt: CHANGED,
    ...extra,
  });
  assert.equal(defined.ok, true, defined.error);
  const approved = approveCommissionPlan(store, {
    actor: SUPER_2,
    tenantId,
    planId,
    changedAt: extra.changedAt ?? CHANGED,
  });
  assert.equal(approved.planStatus, "approved", approved.error);
}

function post(store, actor, tenantId, extra = {}) {
  return quiet(appendLedgerEntry(store, {
    actor,
    tenantId,
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "fixture-event",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
    kind: "earning",
    idempotencyKey: "fixture-key",
    ...extra,
  }));
}

test("earning and hold append once and a release keeps the hold", () => {
  const store = open();
  const list = store.entries;
  putPlan(store, SUPER, "tenant-root", "fixture-rate", { hold: false });
  const earned = post(store, SUPER, "tenant-root", {
    idempotencyKey: "fixture-earn",
  });
  assert.equal(earned.ok, true);
  assert.equal(earned.idempotentReplay, false);
  assert.equal(earned.amount, "1000");
  assert.equal(earned.netFee, "10000");
  assert.equal(earned.planId, "fixture-rate");
  assert.equal(earned.changedAt, CHANGED);
  assert.equal(earned.entryCount, 1);
  assert.equal(store.entries, list);
  assert.equal(store.entries[0].kind, "earning");
  assert.equal(store.entries[0].rate, "1000");
  assert.equal(store.entries[0].planHold, false);
  assert.equal(store.entries[0].idempotencyKey, "fixture-earn");
  assert.deepEqual(store.entries[0].lineage, [{
    tenantId: "tenant-root",
    planId: "fixture-rate",
    changedAt: CHANGED,
    rate: "1000",
    amount: "1000",
  }]);
  assert.equal(Object.isFrozen(store.entries[0]), true);
  assert.equal(Object.isFrozen(earned.entries), true);
  const earningRow = store.entries[0];
  const earningCopy = { ...earningRow };

  const replay = post(store, SUPER, "tenant-root", { idempotencyKey: "fixture-earn" });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.entryCount, 1);
  assert.equal(replay.entries[0], earningRow);

  const secondKey = post(store, SUPER, "tenant-root", { idempotencyKey: "fixture-earn-2" });
  assert.equal(secondKey.error, "event is already recorded");
  assert.equal(secondKey.amount, null);
  assert.equal(store.entries.length, 1);

  const reusedKey = post(store, SUPER, "tenant-root", {
    idempotencyKey: "fixture-earn",
    eventId: "fixture-event-b",
  });
  assert.equal(reusedKey.error, "idempotency key is already recorded");
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0], earningRow);

  putPlan(store, SUPER, "tenant-root", "fixture-hold", {
    action: "hold-share",
    hold: true,
  });
  const immediate = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-earn-denied",
    kind: "earning",
  });
  assert.equal(immediate.error, "hold is required");
  assert.equal(immediate.amount, null);
  assert.equal(store.entries.length, 1);

  const held = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-hold",
    kind: "hold",
  });
  assert.equal(held.ok, true);
  assert.equal(held.kind, "hold");
  assert.equal(held.amount, "1000");
  assert.equal(held.planId, "fixture-hold");
  assert.equal(held.changedAt, CHANGED);
  assert.equal(store.entries[1].planHold, true);
  assert.equal(store.entries.length, 2);
  const holdRow = store.entries[1];
  const holdCopy = { ...holdRow };

  const secondHold = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-hold-2",
    kind: "hold",
  });
  assert.equal(secondHold.error, "event is already recorded");
  assert.equal(store.entries.length, 2);

  const wrongHold = post(store, SUPER, "tenant-root", {
    eventId: "fixture-nohold",
    idempotencyKey: "fixture-nohold",
    kind: "hold",
  });
  assert.equal(wrongHold.error, "hold is not configured");
  assert.equal(store.entries.length, 2);

  const released = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-release",
    kind: "release",
    referenceKey: "fixture-hold",
  });
  assert.equal(released.ok, true);
  assert.equal(released.idempotentReplay, false);
  assert.equal(released.kind, "release");
  assert.equal(released.amount, "1000");
  assert.equal(released.planId, "fixture-hold");
  assert.equal(released.changedAt, CHANGED);
  assert.equal(store.entries.length, 3);
  assert.equal(store.entries[1], holdRow);
  assert.deepEqual(store.entries[1], holdCopy);
  assert.equal(store.entries[2].kind, "release");
  assert.equal(store.entries[2].referenceKey, "fixture-hold");
  assert.equal(store.entries[2].reason, null);
  assert.equal(store.entries[2].rate, "1000");
  assert.throws(() => {
    store.entries[1].amount = "1";
  });

  const secondRelease = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-release-2",
    kind: "release",
    referenceKey: "fixture-hold",
  });
  assert.equal(secondRelease.error, "event is already recorded");
  assert.equal(store.entries.length, 3);

  const releaseReplay = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-release",
    kind: "release",
    referenceKey: "fixture-hold",
  });
  assert.equal(releaseReplay.idempotentReplay, true);
  assert.equal(store.entries.length, 3);

  putPlan(store, SUPER, "tenant-root", "fixture-line-root", {
    action: "lineage",
    hold: false,
  });
  putPlan(store, SUPER, "tenant-a-child", "fixture-line-child", {
    action: "lineage",
    hold: false,
    rate: "500",
  });
  const lined = post(store, SUPER, "tenant-a-child", {
    action: "lineage",
    eventId: "fixture-line",
    idempotencyKey: "fixture-line",
  });
  assert.equal(lined.ok, true);
  assert.equal(lined.amount, "500");
  assert.equal(lined.cumulativeAmount, "1500");
  assert.equal(lined.entries.length, 2);
  assert.equal(store.entries.length, 5);
  assert.equal(store.entries[3].tenantId, "tenant-a-child");
  assert.equal(store.entries[3].planId, "fixture-line-child");
  assert.equal(store.entries[3].amount, "500");
  assert.equal(store.entries[3].rate, "500");
  assert.equal(store.entries[4].tenantId, "tenant-root");
  assert.equal(store.entries[4].planId, "fixture-line-root");
  assert.equal(store.entries[4].amount, "1000");
  assert.equal(store.entries[4].changedAt, CHANGED);
  const lineReplay = post(store, SUPER, "tenant-a-child", {
    action: "lineage",
    eventId: "fixture-line",
    idempotencyKey: "fixture-line",
  });
  assert.equal(lineReplay.idempotentReplay, true);
  assert.equal(lineReplay.entries.length, 2);
  assert.equal(store.entries.length, 5);
  const lineAgain = post(store, SUPER, "tenant-a-child", {
    action: "lineage",
    eventId: "fixture-line",
    idempotencyKey: "fixture-line-2",
  });
  assert.equal(lineAgain.error, "event is already recorded");
  assert.equal(store.entries.length, 5);

  putPlan(store, SUPER, "tenant-root", "fixture-cap-root", {
    action: "capped",
    hold: false,
    rateCap: "2500",
  });
  putPlan(store, SUPER, "tenant-a-child", "fixture-cap-child", {
    action: "capped",
    hold: false,
    rate: "2000",
    rateCap: "2500",
  });
  const capped = post(store, SUPER, "tenant-a-child", {
    action: "capped",
    eventId: "fixture-capped",
    idempotencyKey: "fixture-capped",
  });
  assert.equal(capped.error, "ancestor cap exceeded");
  assert.equal(capped.amount, null);
  assert.equal(store.entries.length, 5);

  putPlan(store, SUPER, "tenant-root", "fixture-later", {
    hold: false,
    rate: "800",
    changedAt: "2026-10-07T03:00:00Z",
    effectiveFrom: "2026-10-20T00:00:00Z",
    effectiveTo: "2026-10-28T00:00:00Z",
  });
  const later = post(store, SUPER, "tenant-root", {
    eventId: "fixture-later",
    idempotencyKey: "fixture-later",
    occurredAt: "2026-10-21T00:00:00Z",
  });
  assert.equal(later.ok, true);
  assert.equal(later.amount, "800");
  assert.equal(later.planId, "fixture-later");
  assert.equal(later.changedAt, "2026-10-07T03:00:00Z");
  assert.equal(store.entries[0], earningRow);
  assert.deepEqual(store.entries[0], earningCopy);
  assert.equal(store.entries[0].rate, "1000");
  assert.equal(store.entries[0].amount, "1000");
  assert.equal(store.entries.at(-1).rate, "800");
});

test("refund and reversal append a correction and preserve the original", () => {
  const store = open();
  putPlan(store, SUPER, "tenant-root", "fixture-rate", { hold: false });
  const earned = post(store, SUPER, "tenant-root", { idempotencyKey: "fixture-earn" });
  assert.equal(earned.ok, true);
  const original = store.entries[0];
  const copy = { ...original };

  const reversed = post(store, SUPER, "tenant-root", {
    kind: "reversal",
    idempotencyKey: "fixture-reversal",
    referenceKey: "fixture-earn",
    reason: "adjusted",
  });
  assert.equal(reversed.ok, true);
  assert.equal(reversed.idempotentReplay, false);
  assert.equal(reversed.kind, "reversal");
  assert.equal(reversed.amount, "1000");
  assert.equal(reversed.planId, "fixture-rate");
  assert.equal(reversed.changedAt, CHANGED);
  assert.equal(store.entries.length, 2);
  assert.equal(store.entries[0], original);
  assert.deepEqual(store.entries[0], copy);
  assert.equal(store.entries[0].kind, "earning");
  assert.equal(store.entries[0].amount, "1000");
  assert.equal(store.entries[0].rate, "1000");
  assert.equal(store.entries[1].kind, "reversal");
  assert.equal(store.entries[1].amount, "1000");
  assert.equal(store.entries[1].planId, "fixture-rate");
  assert.equal(store.entries[1].changedAt, CHANGED);
  assert.equal(store.entries[1].rate, "1000");
  assert.equal(store.entries[1].reason, "adjusted");
  assert.equal(store.entries[1].referenceKey, "fixture-earn");
  assert.equal(Object.isFrozen(store.entries[1]), true);
  assert.throws(() => {
    store.entries[0].rate = "1";
  });

  const second = post(store, SUPER, "tenant-root", {
    kind: "reversal",
    idempotencyKey: "fixture-reversal-2",
    referenceKey: "fixture-earn",
    reason: "adjusted",
  });
  assert.equal(second.error, "event is already recorded");
  assert.equal(store.entries.length, 2);
  assert.equal(store.entries[0], original);

  const reversalReplay = post(store, SUPER, "tenant-root", {
    kind: "reversal",
    idempotencyKey: "fixture-reversal",
    referenceKey: "fixture-earn",
    reason: "adjusted",
  });
  assert.equal(reversalReplay.idempotentReplay, true);
  assert.equal(store.entries.length, 2);

  const earnedRefund = post(store, SUPER, "tenant-root", {
    eventId: "fixture-refund-event",
    idempotencyKey: "fixture-earn-refund",
  });
  assert.equal(earnedRefund.ok, true);
  const refundOriginal = store.entries[2];
  const refundCopy = { ...refundOriginal };
  const refunded = post(store, SUPER, "tenant-root", {
    eventId: "fixture-refund-event",
    kind: "refund",
    idempotencyKey: "fixture-refund",
    referenceKey: "fixture-earn-refund",
    reason: "reversed",
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.kind, "refund");
  assert.equal(refunded.amount, "1000");
  assert.equal(store.entries.length, 4);
  assert.equal(store.entries[2], refundOriginal);
  assert.deepEqual(store.entries[2], refundCopy);
  assert.equal(store.entries[2].kind, "earning");
  assert.equal(store.entries[3].kind, "refund");
  assert.equal(store.entries[3].reason, "reversed");
  assert.equal(store.entries[3].planId, refundOriginal.planId);
  assert.equal(store.entries[3].changedAt, refundOriginal.changedAt);

  const secondRefund = post(store, SUPER, "tenant-root", {
    eventId: "fixture-refund-event",
    kind: "refund",
    idempotencyKey: "fixture-refund-2",
    referenceKey: "fixture-earn-refund",
    reason: "reversed",
  });
  assert.equal(secondRefund.error, "event is already recorded");
  assert.equal(store.entries.length, 4);

  const earnedMismatch = post(store, SUPER, "tenant-root", {
    eventId: "fixture-mismatch-event",
    idempotencyKey: "fixture-earn-mismatch",
  });
  assert.equal(earnedMismatch.ok, true);
  const mismatch = post(store, SUPER, "tenant-root", {
    eventId: "fixture-mismatch-event",
    kind: "reversal",
    idempotencyKey: "fixture-mismatch",
    referenceKey: "fixture-earn-mismatch",
    reason: "adjusted",
    amount: "9.001",
  });
  assert.equal(mismatch.error, "amount does not match");
  assert.equal(mismatch.amount, null);
  assert.equal(JSON.stringify(mismatch).includes("9.001"), false);
  assert.equal(JSON.stringify(store).includes("9.001"), false);
  assert.equal(store.entries.length, 5);
  assert.equal(store.entries.at(-1).kind, "earning");

  const earnedReason = post(store, SUPER, "tenant-root", {
    eventId: "fixture-reason-event",
    idempotencyKey: "fixture-earn-reason",
  });
  assert.equal(earnedReason.ok, true);
  const missingReason = post(store, SUPER, "tenant-root", {
    eventId: "fixture-reason-event",
    kind: "reversal",
    idempotencyKey: "fixture-reason",
    referenceKey: "fixture-earn-reason",
  });
  assert.equal(missingReason.error, "reason is not configured");
  assert.equal(store.entries.length, 6);
  const guessed = post(store, SUPER, "tenant-root", {
    eventId: "fixture-reason-event",
    kind: "refund",
    idempotencyKey: "fixture-guessed",
    referenceKey: "fixture-earn-reason",
    reason: "guessed-version",
  });
  assert.equal(guessed.error, "reason is not configured");
  assert.equal(JSON.stringify(guessed).includes("guessed-version"), false);
  assert.equal(store.entries.length, 6);

  const missing = post(store, SUPER, "tenant-root", {
    kind: "reversal",
    idempotencyKey: "fixture-missing",
    referenceKey: "fixture-absent",
    reason: "adjusted",
    eventId: "fixture-absent-event",
  });
  assert.equal(missing.error, "entry is not recorded");
  assert.equal(store.entries.length, 6);

  putPlan(store, SUPER, "tenant-root", "fixture-hold", {
    action: "hold-share",
    hold: true,
  });
  const held = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    idempotencyKey: "fixture-hold",
    kind: "hold",
  });
  assert.equal(held.ok, true);
  const holdRow = store.entries.at(-1);
  const holdCopy = { ...holdRow };
  const holdIndex = store.entries.length - 1;
  const holdReversal = post(store, SUPER, "tenant-root", {
    action: "hold-share",
    eventId: "fixture-hold-event",
    kind: "reversal",
    idempotencyKey: "fixture-hold-reversal",
    referenceKey: "fixture-hold",
    reason: "adjusted",
  });
  assert.equal(holdReversal.ok, true);
  assert.equal(store.entries[holdIndex], holdRow);
  assert.deepEqual(store.entries[holdIndex], holdCopy);
  assert.equal(store.entries[holdIndex].kind, "hold");
  assert.equal(store.entries.at(-1).kind, "reversal");
  assert.equal(store.entries.at(-1).amount, holdRow.amount);
  assert.equal(store.entries.at(-1).planId, holdRow.planId);
  assert.equal(store.entries.at(-1).changedAt, holdRow.changedAt);
});

test("unauthorized, secret, pending, and excluded posts append nothing", () => {
  const store = open();
  putPlan(store, SUPER, "tenant-root", "fixture-rate", { hold: false });
  const defined = defineCommissionPlan(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    planId: "fixture-pending",
    product: "distributor",
    action: "pending-share",
    eligibleRole: "Distributor",
    basis: "realized performance fee",
    rate: "1000",
    rateCap: "4000",
    parentShare: "5000",
    childShare: "4000",
    platformShare: "1000",
    effectiveFrom: FROM,
    effectiveTo: TO,
    currency: "USDT",
    hold: false,
    refund: "reversed",
    reversal: "adjusted",
    requiredApprovers: [{ id: SUPER_2.id, role: "Super Admin" }],
    changedAt: CHANGED,
  });
  assert.equal(defined.planStatus, "pending", defined.error);

  const before = store.entries.length;
  const pending = post(store, SUPER, "tenant-root", {
    action: "pending-share",
    eventId: "fixture-pending-event",
    idempotencyKey: "fixture-pending-key",
  });
  assert.equal(pending.error, "plan is not in effect");
  assert.equal(store.entries.length, before);
  assert.equal(store.plans.find((row) => row.planId === "fixture-pending").rate, "1000");

  const cancelled = post(store, SUPER, "tenant-root", {
    orderStatus: "cancelled",
    eventId: "fixture-cancelled",
    idempotencyKey: "fixture-cancelled",
  });
  assert.equal(cancelled.error, "order is excluded");
  const rejected = post(store, SUPER, "tenant-root", {
    orderStatus: "rejected",
    eventId: "fixture-rejected",
    idempotencyKey: "fixture-rejected",
  });
  assert.equal(rejected.error, "order is excluded");

  const notional = post(store, SUPER, "tenant-root", {
    notional: "fixture-notional",
    eventId: "fixture-notional-event",
    idempotencyKey: "fixture-notional-key",
  });
  assert.equal(notional.error, "basis is not approved");
  const unrealized = post(store, SUPER, "tenant-root", {
    unrealizedPnl: "fixture-unrealized",
    eventId: "fixture-unrealized-event",
    idempotencyKey: "fixture-unrealized-key",
  });
  assert.equal(unrealized.error, "basis is not approved");
  const paper = post(store, SUPER, "tenant-root", {
    paperPnl: "fixture-paper",
    eventId: "fixture-paper-event",
    idempotencyKey: "fixture-paper-key",
  });
  assert.equal(paper.error, "basis is not approved");
  const rounded = post(store, SUPER, "tenant-root", {
    rounding: "half-up",
    eventId: "fixture-rounded",
    idempotencyKey: "fixture-rounded",
  });
  assert.equal(rounded.error, "rounding is not configured");
  assert.equal(rounded.amount, null);

  const customer = post(store, CUSTOMER, "tenant-a-child", {
    eventId: "fixture-customer-event",
    idempotencyKey: "fixture-customer-key",
  });
  assert.equal(customer.error, "role scope denied");
  const distributor = post(store, DIST, "tenant-a-child", {
    eventId: "fixture-dist-event",
    idempotencyKey: "fixture-dist-key",
  });
  assert.equal(distributor.error, "role scope denied");
  const superDist = post(store, SUPER_DIST, "tenant-root", {
    eventId: "fixture-super-dist-event",
    idempotencyKey: "fixture-super-dist-key",
  });
  assert.equal(superDist.error, "role scope denied");
  const outside = post(store, ADMIN, "tenant-b", {
    eventId: "fixture-outside",
    idempotencyKey: "fixture-outside",
  });
  assert.equal(outside.error, "tenant is outside subtree");
  const permission = post(store, SUPER, "tenant-root", {
    permission: "checklist.write",
    eventId: "fixture-permission",
    idempotencyKey: "fixture-permission",
  });
  assert.equal(permission.error, "permission is not granted");
  const payout = post(store, SUPER, "tenant-root", {
    kind: "payout",
    eventId: "fixture-payout",
    idempotencyKey: "fixture-payout",
  });
  assert.equal(payout.error, "entry kind is not approved");
  assert.equal(JSON.stringify(payout).includes("payout"), false);
  const missingKey = post(store, SUPER, "tenant-root", {
    eventId: "fixture-missing-key",
    idempotencyKey: " ",
  });
  assert.equal(missingKey.error, "idempotency key is not configured");

  const secret = post(store, SUPER, "tenant-root", {
    eventId: "bearer fixture-token",
    idempotencyKey: "fixture-secret",
    credential: "fixture-credential",
  });
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);
  assert.equal(store.entries.length, before);

  const bare = tree();
  const unconfigured = appendLedgerEntry(bare, {
    actor: SUPER,
    tenantId: "tenant-root",
    kind: "earning",
    idempotencyKey: "fixture-bare",
  });
  assert.equal(unconfigured.error, "ledger is not configured");
  assert.equal(bare.entries, undefined);

  const direct = calculateCommission(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "fixture-direct",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.amount, "1000");
  assert.equal(store.entries.length, before);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/commission-ledger.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("Math.round"), false);
  assert.equal(source.includes("half-up"), false);
  assert.equal(/\bINSERT\b/.test(source), false);
  assert.equal(/\bUPDATE\b/.test(source), false);
  assert.equal(/\bDELETE\b/.test(source), false);
  assert.equal(source.includes("splice("), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  for (const name of ROLE_NAMES) assert.equal(PERMISSION_MATRIX[name].length, 0);
  assert.equal(catalogGrants("Admin").length, 0);
  assert.deepEqual(Object.keys(ledgerApi).sort(), [
    "COMMISSION_LEDGER_LIMITATIONS",
    "appendLedgerEntry",
  ]);
  assert.deepEqual(Object.keys(calculationApi).sort(), [
    "COMMISSION_CALCULATION_LIMITATIONS",
    "calculateCommission",
  ]);
  assert.deepEqual(Object.keys(planApi).sort(), [
    "COMMISSION_PLAN_LIMITATIONS",
    "approveCommissionPlan",
    "createCommissionStore",
    "defineCommissionPlan",
  ]);
  assert.equal(COMMISSION_LEDGER_LIMITATIONS.includes("entries are append-only"), true);
  assert.equal(COMMISSION_LEDGER_LIMITATIONS.includes("a duplicate event is not paid twice"), true);
  assert.equal(COMMISSION_LEDGER_LIMITATIONS.includes("hold duration is NOT IN SOURCE"), true);
  assert.equal(COMMISSION_LEDGER_LIMITATIONS.includes("statement totals are not this module"), true);
  assert.equal(COMMISSION_CALCULATION_LIMITATIONS.includes("ledger entries are not written"), true);
  assert.equal(COMMISSION_CALCULATION_LIMITATIONS.includes("a remainder is not rounded"), true);
  assert.equal(authorizeShell(CUSTOMER, "tenant-a-child").editChecklist, false);
});
