import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { PERMISSION_MATRIX, ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import * as calculationApi from "../services/commission-calculation.mjs";
import * as ledgerApi from "../services/commission-ledger.mjs";
import { appendLedgerEntry } from "../services/commission-ledger.mjs";
import * as planApi from "../services/commission-plans.mjs";
import {
  approveCommissionPlan,
  createCommissionStore,
  defineCommissionPlan,
} from "../services/commission-plans.mjs";
import {
  COMMISSION_SETTLEMENT_LIMITATIONS,
  defineCommissionPolicy,
  readCommissionReport,
  reconcileCommissionLedger,
} from "../services/commission-settlement.mjs";
import * as settlementApi from "../services/commission-settlement.mjs";
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
const RETAILER = { id: "fixture-retailer", role: "Retailer", tenantId: "tenant-a" };
const SUPER_DIST = { id: "fixture-super-dist", role: "Super Distributor", tenantId: "tenant-root" };
const CUSTOMER = { id: "fixture-customer-payee", role: "Customer", tenantId: "tenant-a" };
const SHELL_CUSTOMER = { id: "fixture-customer", role: "Customer", tenantId: "tenant-a-child" };

function quiet(result) {
  const body = JSON.stringify(result);
  assert.equal(body.includes("bearer fixture-token"), false);
  assert.equal(body.includes("fixture-credential"), false);
  assert.equal(body.includes("checklist.write"), false);
  assert.equal(body.includes("fixture-notional"), false);
  assert.equal(body.includes("half-up"), false);
  assert.equal(body.includes("fixture-approved"), false);
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveEnabled, false);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.credentialStored, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.promoted, false);
  assert.equal(result.policyApplied, false);
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
  store.entries = [];
  store.policies = [];
  return store;
}

function putPlan(store, actor, tenantId, planId, extra = {}) {
  const approve = extra.approve !== false;
  const fields = { ...extra };
  delete fields.approve;
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
    hold: false,
    refund: "reversed",
    reversal: "adjusted",
    requiredApprovers: [{ id: SUPER_2.id, role: "Super Admin" }],
    changedAt: CHANGED,
    ...fields,
  });
  assert.equal(defined.ok, true, defined.error);
  if (!approve) return defined;
  const approved = approveCommissionPlan(store, {
    actor: SUPER_2,
    tenantId,
    planId,
    changedAt: extra.changedAt ?? CHANGED,
  });
  assert.equal(approved.planStatus, "approved", approved.error);
  return approved;
}

function post(store, actor, tenantId, extra = {}) {
  const result = appendLedgerEntry(store, {
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
  });
  assert.equal(result.ok, true, result.error);
  return result;
}

function read(store, actor, tenantId, extra = {}) {
  return quiet(readCommissionReport(store, { actor, tenantId, ...extra }));
}

function reconcile(store, actor, tenantId, stated, extra = {}) {
  return quiet(reconcileCommissionLedger(store, {
    actor,
    tenantId,
    ...stated,
    ...extra,
  }));
}

test("reconciliation balances earned, pending, settled, reversed, and statement", () => {
  const store = tree();
  putPlan(store, SUPER, "tenant-root", "fixture-rate");
  putPlan(store, SUPER, "tenant-root", "fixture-hold", { action: "hold-share", hold: true });
  post(store, SUPER, "tenant-root", { eventId: "fixture-earn", idempotencyKey: "fixture-earn" });
  post(store, SUPER, "tenant-root", {
    action: "hold-share",
    kind: "hold",
    eventId: "fixture-released-hold",
    idempotencyKey: "fixture-released-hold",
  });
  post(store, SUPER, "tenant-root", {
    action: "hold-share",
    kind: "release",
    eventId: "fixture-released-hold",
    idempotencyKey: "fixture-release",
    referenceKey: "fixture-released-hold",
  });
  post(store, SUPER, "tenant-root", { eventId: "fixture-rev-earn", idempotencyKey: "fixture-rev-earn" });
  post(store, SUPER, "tenant-root", {
    kind: "reversal",
    eventId: "fixture-rev-earn",
    idempotencyKey: "fixture-reversal",
    referenceKey: "fixture-rev-earn",
    reason: "adjusted",
  });
  post(store, SUPER, "tenant-root", { eventId: "fixture-refund-earn", idempotencyKey: "fixture-refund-earn" });
  post(store, SUPER, "tenant-root", {
    kind: "refund",
    eventId: "fixture-refund-earn",
    idempotencyKey: "fixture-refund",
    referenceKey: "fixture-refund-earn",
    reason: "reversed",
  });
  post(store, SUPER, "tenant-root", {
    action: "hold-share",
    kind: "hold",
    eventId: "fixture-pending-hold",
    idempotencyKey: "fixture-pending-hold",
  });

  const list = store.entries;
  const length = list.length;
  const original = list[0];
  const copy = { ...original };
  const report = read(store, SUPER, "tenant-root");
  assert.equal(report.ok, true);
  assert.equal(report.earned, "5000");
  assert.equal(report.pending, "1000");
  assert.equal(report.settled, "2000");
  assert.equal(report.reversed, "2000");
  assert.equal(report.statement, "3000");
  assert.equal(report.currency, "USDT");
  assert.equal(report.entryCount, 8);
  assert.equal(report.policyStatus, null);
  assert.equal(store.entries, list);
  assert.equal(store.entries.length, length);
  assert.equal(store.entries[0], original);

  const balanced = reconcile(store, SUPER, "tenant-root", {
    earned: "5000",
    pending: "1000",
    settled: "2000",
    reversed: "2000",
    statement: "3000",
  });
  assert.equal(balanced.ok, true);
  assert.equal(balanced.reconciled, true);
  assert.equal(balanced.alert, false);
  assert.equal(balanced.earned, "5000");
  assert.equal(balanced.statement, "3000");
  assert.equal(store.entries.length, length);
  assert.deepEqual(store.entries[0], copy);

  const again = reconcile(store, SUPER, "tenant-root", {
    earned: "5000",
    pending: "1000",
    settled: "2000",
    reversed: "2000",
    statement: "3000",
  });
  assert.deepEqual(again.earned, balanced.earned);
  assert.equal(again.reconciled, true);
  assert.equal(store.entries.length, length);

  const mismatch = reconcile(store, SUPER, "tenant-root", {
    earned: "9.001",
    pending: "1000",
    settled: "2000",
    reversed: "2000",
    statement: "3000",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "statement does not match");
  assert.equal(mismatch.reconciled, false);
  assert.equal(mismatch.alert, true);
  assert.equal(mismatch.earned, "5000");
  assert.equal(mismatch.stated.earned, "9.001");
  assert.equal(store.entries.length, length);
  assert.equal(store.entries[0], original);

  const defined = defineCommissionPolicy(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    policyId: "fixture-policy",
    changedAt: CHANGED,
    note: "fixture-policy",
  });
  assert.equal(defined.ok, true, defined.error);
  assert.equal(defined.policyStatus, "pending");
  assert.equal(defined.policyApplied, false);
  const replay = defineCommissionPolicy(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    policyId: "fixture-policy",
    changedAt: CHANGED,
    note: "fixture-policy",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.policies.length, 1);
  const approved = quiet(defineCommissionPolicy(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    policyId: "fixture-policy",
    changedAt: CHANGED,
    status: "fixture-approved",
  }));
  assert.equal(approved.error, "formal approval is not recorded");
  assert.equal(store.policies.length, 1);
  assert.equal(store.policies[0].status, "pending");
  const adminPolicy = defineCommissionPolicy(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    policyId: "fixture-admin-policy",
    changedAt: CHANGED,
  });
  assert.equal(adminPolicy.error, "role scope denied");
  assert.equal(store.policies.length, 1);

  const afterPolicy = read(store, SUPER, "tenant-root");
  assert.equal(afterPolicy.earned, "5000");
  assert.equal(afterPolicy.statement, "3000");
  assert.equal(afterPolicy.policyStatus, "pending");
  assert.equal(afterPolicy.policyApplied, false);
  assert.equal(afterPolicy.policies[0].policyId, "fixture-policy");
  assert.equal(afterPolicy.policies[0].status, "pending");

  store.entries.push(Object.freeze({
    idempotencyKey: "fixture-broken",
    kind: "release",
    referenceKey: "fixture-missing",
    tenantId: "tenant-root",
    planId: "fixture-hold",
    changedAt: CHANGED,
    amount: "1",
    currency: "USDT",
    customerId: "fixture-customer-payee",
  }));
  const broken = reconcile(store, SUPER, "tenant-root", {
    earned: "5000",
    pending: "1000",
    settled: "2000",
    reversed: "2000",
    statement: "3000",
  });
  assert.equal(broken.error, "ledger is not balanced");
  assert.equal(broken.reconciled, null);
  assert.equal(broken.earned, null);
  assert.equal(store.entries.length, length + 1);
  assert.equal(store.entries[0], original);
  assert.equal(store.entries.at(-1).amount, "1");
});

test("a role cannot view or edit another subtree ledger", () => {
  const store = tree();
  putPlan(store, SUPER, "tenant-root", "fixture-root");
  putPlan(store, SUPER, "tenant-a", "fixture-child");
  putPlan(store, SUPER, "tenant-a", "fixture-pending", { action: "pending-share", approve: false });
  post(store, SUPER, "tenant-a", {
    eventId: "fixture-own",
    idempotencyKey: "fixture-own",
    customerId: "fixture-customer-payee",
  });
  post(store, SUPER, "tenant-a", {
    eventId: "fixture-other",
    idempotencyKey: "fixture-other",
    customerId: "fixture-other-payee",
  });
  const length = store.entries.length;
  const first = store.entries[0];

  const admin = read(store, ADMIN, "tenant-a");
  assert.equal(admin.ok, true);
  assert.equal(admin.earned, "2000");
  assert.equal(admin.pending, "0");
  assert.equal(admin.settled, "2000");
  assert.equal(admin.reversed, "0");
  assert.equal(admin.statement, "2000");
  assert.equal(admin.entryCount, 2);
  assert.equal(admin.entries.every((row) => row.tenantId === "tenant-a"), true);
  const trailIds = admin.approvalTrail.map((row) => row.planId);
  assert.equal(trailIds.includes("fixture-child"), true);
  assert.equal(trailIds.includes("fixture-pending"), true);
  assert.equal(trailIds.includes("fixture-root"), false);
  const pending = admin.approvalTrail.find((row) => row.planId === "fixture-pending");
  assert.equal(pending.status, "pending");
  assert.equal(pending.approvals.length, 0);
  const child = admin.approvalTrail.find((row) => row.planId === "fixture-child");
  assert.equal(child.status, "approved");
  assert.equal(child.makerId, SUPER.id);
  assert.equal(child.approvals[0].approverId, SUPER_2.id);
  assert.equal(child.basis, "realized performance fee");

  const rootView = read(store, SUPER, "tenant-root");
  assert.equal(rootView.earned, "4000");
  assert.equal(rootView.entries.some((row) => row.tenantId === "tenant-root"), true);
  assert.equal(rootView.entries.some((row) => row.tenantId === "tenant-a"), true);

  const customer = read(store, CUSTOMER, "tenant-a");
  assert.equal(customer.ok, true);
  assert.equal(customer.earned, "1000");
  assert.equal(customer.statement, "1000");
  assert.equal(customer.entryCount, 1);
  assert.equal(customer.entries[0].customerId, "fixture-customer-payee");
  assert.equal(JSON.stringify(customer).includes("fixture-other-payee"), false);
  assert.equal(customer.approvalTrail.length, 1);
  assert.equal(customer.approvalTrail[0].planId, "fixture-child");

  const outside = read(store, ADMIN, "tenant-b");
  assert.equal(outside.error, "tenant is outside subtree");
  assert.equal(outside.entries, null);
  assert.equal(outside.approvalTrail, null);
  assert.equal(outside.earned, null);
  assert.equal(JSON.stringify(outside).includes("fixture-other-payee"), false);
  assert.equal(JSON.stringify(outside).includes("fixture-child"), false);

  const parent = read(store, DIST, "tenant-a");
  assert.equal(parent.error, "tenant is outside subtree");
  assert.equal(parent.entries, null);
  const retailer = read(store, RETAILER, "tenant-b");
  assert.equal(retailer.error, "tenant is outside subtree");
  const superDist = read(store, SUPER_DIST, "tenant-root");
  assert.equal(superDist.error, "role scope denied");
  assert.equal(superDist.entries, null);

  const ownNetwork = read(store, DIST, "tenant-a-child");
  assert.equal(ownNetwork.ok, true);
  assert.equal(ownNetwork.earned, "0");
  assert.equal(ownNetwork.statement, "0");
  assert.equal(ownNetwork.entryCount, 0);

  const editAdmin = appendLedgerEntry(store, {
    actor: ADMIN,
    tenantId: "tenant-b",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "fixture-escape",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
    kind: "earning",
    idempotencyKey: "fixture-escape",
  });
  assert.equal(editAdmin.error, "tenant is outside subtree");
  const editDist = appendLedgerEntry(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "fixture-dist-edit",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
    kind: "earning",
    idempotencyKey: "fixture-dist-edit",
  });
  assert.equal(editDist.error, "role scope denied");
  const editCustomer = appendLedgerEntry(store, {
    actor: CUSTOMER,
    tenantId: "tenant-a",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "fixture-customer-edit",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
    kind: "earning",
    idempotencyKey: "fixture-customer-edit",
  });
  assert.equal(editCustomer.error, "role scope denied");
  assert.equal(store.entries.length, length);
  assert.equal(store.entries[0], first);
});

test("unauthorized policy, secrets, and catalog grants do not change the ledger", () => {
  const store = tree();
  putPlan(store, SUPER, "tenant-root", "fixture-rate");
  post(store, SUPER, "tenant-root", { idempotencyKey: "fixture-earn", eventId: "fixture-earn" });
  const length = store.entries.length;
  const permission = read(store, SUPER, "tenant-root", { permission: "checklist.write" });
  assert.equal(permission.error, "permission is not granted");
  assert.equal(permission.entries, null);
  const secret = quiet(readCommissionReport(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    credential: "fixture-credential",
  }));
  assert.equal(secret.error, "live credentials are not allowed");
  const leaked = quiet(reconcileCommissionLedger(store, {
    actor: SUPER,
    tenantId: "bearer fixture-token",
    earned: "1000",
    pending: "0",
    settled: "1000",
    reversed: "0",
    statement: "1000",
  }));
  assert.equal(leaked.error, "secret value is not allowed");
  const badStatement = quiet(reconcileCommissionLedger(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    earned: "fixture-notional",
    pending: "0",
    settled: "0",
    reversed: "0",
    statement: "0",
  }));
  assert.equal(badStatement.error, "statement is not configured");
  assert.equal(JSON.stringify(badStatement).includes("fixture-notional"), false);
  const rounded = quiet(readCommissionReport(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    rounding: "half-up",
  }));
  assert.equal(rounded.error, "unsupported field");
  assert.equal(store.entries.length, length);
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);
  assert.equal(JSON.stringify(store).includes("fixture-notional"), false);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/commission-settlement.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("Math.round"), false);
  assert.equal(source.includes("half-up"), false);
  assert.equal(source.includes("entries.push"), false);
  assert.equal(source.includes("splice("), false);
  assert.equal(source.includes("calculateCommission"), false);
  assert.equal(source.includes("appendLedgerEntry"), false);
  assert.equal(/\bINSERT\b/.test(source), false);
  assert.equal(/\bUPDATE\b/.test(source), false);
  assert.equal(/\bDELETE\b/.test(source), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  for (const name of ROLE_NAMES) assert.equal(PERMISSION_MATRIX[name].length, 0);
  assert.equal(catalogGrants("Admin").length, 0);
  assert.deepEqual(Object.keys(settlementApi).sort(), [
    "COMMISSION_SETTLEMENT_LIMITATIONS",
    "defineCommissionPolicy",
    "readCommissionReport",
    "reconcileCommissionLedger",
  ]);
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
  assert.equal(COMMISSION_SETTLEMENT_LIMITATIONS.includes("a balanced statement is not a payout"), true);
  assert.equal(COMMISSION_SETTLEMENT_LIMITATIONS.includes("business and legal commission policy stays pending"), true);
  assert.equal(COMMISSION_SETTLEMENT_LIMITATIONS.includes("high-water mark is NOT IN SOURCE"), true);
  assert.equal(authorizeShell(SHELL_CUSTOMER, "tenant-a-child").editChecklist, false);
});
