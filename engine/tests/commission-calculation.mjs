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
  approveCommissionPlan,
  createCommissionStore,
  defineCommissionPlan,
} from "../services/commission-plans.mjs";
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

function event(store, actor, tenantId, extra = {}) {
  return quiet(calculateCommission(store, {
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
    ...extra,
  }));
}

test("net fee uses the snapshot rate and does not become notional or unrealized pnl", () => {
  const store = tree();
  putPlan(store, SUPER, "tenant-root", "fixture-rate");
  const plansBefore = store.plans.length;
  const feeOnly = event(store, SUPER, "tenant-root");
  assert.equal(feeOnly.ok, true);
  assert.equal(feeOnly.netFee, "10000");
  assert.equal(feeOnly.amount, "1000");
  assert.equal(feeOnly.snapshot.rate, "1000");
  assert.equal(feeOnly.snapshot.changedAt, CHANGED);
  assert.equal(feeOnly.snapshot.basis, "realized performance fee");
  assert.equal(feeOnly.cumulativeAmount, "1000");
  assert.equal(feeOnly.capAmount, "4000");
  assert.equal(store.plans.length, plansBefore);
  assert.equal(store.entries, undefined);

  const refunded = event(store, SUPER, "tenant-root", {
    eventId: "fixture-refund",
    refund: "2500",
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.netFee, "7500");
  assert.equal(refunded.amount, "750");

  const excluded = event(store, SUPER, "tenant-root", {
    eventId: "fixture-exclusion",
    exclusions: ["1000"],
  });
  assert.equal(excluded.ok, true);
  assert.equal(excluded.netFee, "9000");
  assert.equal(excluded.amount, "900");

  const both = event(store, SUPER, "tenant-root", {
    eventId: "fixture-both-adjustments",
    refund: "2500",
    exclusions: ["1000"],
  });
  assert.equal(both.netFee, "6500");
  assert.equal(both.amount, "650");

  const zero = event(store, SUPER, "tenant-root", {
    eventId: "fixture-zero",
    fee: "100",
    refund: "100",
  });
  assert.equal(zero.ok, true);
  assert.equal(zero.netFee, "0");
  assert.equal(zero.amount, "0");

  const negative = event(store, SUPER, "tenant-root", {
    eventId: "fixture-negative",
    fee: "100",
    refund: "150",
  });
  assert.equal(negative.error, "net fee is not positive");
  assert.equal(negative.amount, null);

  putPlan(store, SUPER, "tenant-root", "fixture-exact", {
    action: "exact",
    rate: "1",
    rateCap: "1",
    parentShare: "0",
    childShare: "1",
    platformShare: "0",
    changedAt: "2026-10-07T01:00:00Z",
  });
  const exact = event(store, SUPER, "tenant-root", {
    action: "exact",
    eventId: "fixture-exact-event",
    fee: "1",
  });
  assert.equal(exact.amount, "0.0001");
  assert.notEqual(exact.amount, "0");
  const finer = event(store, SUPER, "tenant-root", {
    action: "exact",
    eventId: "fixture-finer",
    fee: "0.5",
  });
  assert.equal(finer.amount, "0.00005");
  const rounded = event(store, SUPER, "tenant-root", {
    action: "exact",
    eventId: "fixture-round",
    fee: "1",
    rounding: "half-up",
  });
  assert.equal(rounded.error, "rounding is not configured");
  assert.equal(rounded.amount, null);

  const notional = event(store, SUPER, "tenant-root", { notional: "fixture-notional" });
  assert.equal(notional.error, "basis is not approved");
  assert.equal(notional.amount, null);
  const unrealized = event(store, SUPER, "tenant-root", { unrealizedPnl: "fixture-unrealized" });
  assert.equal(unrealized.error, "basis is not approved");
  const paper = event(store, SUPER, "tenant-root", { paperPnl: "fixture-paper" });
  assert.equal(paper.error, "basis is not approved");
  const missingFee = event(store, SUPER, "tenant-root", { fee: undefined, notional: "fixture-notional" });
  assert.equal(missingFee.error, "basis is not approved");
  assert.equal(missingFee.amount, null);
  const noFee = event(store, SUPER, "tenant-root", { eventId: "fixture-no-fee", fee: "" });
  assert.equal(noFee.error, "fee is not configured");
  assert.equal(JSON.stringify(store).includes("fixture-notional"), false);
  assert.equal(JSON.stringify(store).includes("fixture-unrealized"), false);
});

test("the lineage total cannot exceed the tightest ancestor cap", () => {
  const store = tree();
  putPlan(store, SUPER, "tenant-root", "fixture-root-cap", {
    action: "capped",
    rate: "1000",
    rateCap: "2500",
    parentShare: "5000",
    childShare: "2500",
    platformShare: "2500",
  });
  putPlan(store, ADMIN, "tenant-a-child", "fixture-child-cap", {
    action: "capped",
    rate: "2000",
    rateCap: "2500",
    parentShare: "5000",
    childShare: "2500",
    platformShare: "2500",
    changedAt: "2026-10-07T03:00:00Z",
  });
  const over = event(store, ADMIN, "tenant-a-child", { action: "capped", eventId: "fixture-over-cap" });
  assert.equal(over.error, "ancestor cap exceeded");
  assert.equal(over.amount, null);
  assert.equal(over.cumulativeAmount, null);
  assert.equal(over.cumulativeRate, "3000");
  assert.equal(over.ancestorCap, "2500");
  assert.equal(over.netFee, "10000");

  putPlan(store, SUPER, "tenant-root", "fixture-root-ok", {
    action: "open",
    rate: "1000",
    rateCap: "4000",
  });
  putPlan(store, ADMIN, "tenant-a-child", "fixture-child-ok", {
    action: "open",
    rate: "500",
    rateCap: "4000",
    changedAt: "2026-10-07T04:00:00Z",
  });
  const within = event(store, ADMIN, "tenant-a-child", { action: "open", eventId: "fixture-within" });
  assert.equal(within.ok, true);
  assert.equal(within.amount, "500");
  assert.equal(within.lines[0].amount, "500");
  assert.equal(within.lines[0].rate, "500");
  assert.equal(within.lines[1].amount, "1000");
  assert.equal(within.lines[1].tenantId, "tenant-root");
  assert.equal(within.cumulativeAmount, "1500");
  assert.equal(within.cumulativeRate, "1500");
  assert.equal(within.ancestorCap, "4000");
  assert.equal(within.capAmount, "4000");
  const again = event(store, ADMIN, "tenant-a-child", { action: "open", eventId: "fixture-within" });
  assert.deepEqual(again.lines, within.lines);

  putPlan(store, SUPER, "tenant-root", "fixture-later", {
    action: "open",
    rate: "800",
    rateCap: "4000",
    changedAt: "2026-10-20T00:00:00Z",
    effectiveFrom: "2026-10-20T00:00:00Z",
    effectiveTo: "2026-10-28T00:00:00Z",
  });
  assert.equal(within.snapshot.rate, "500");
  assert.equal(within.amount, "500");
  const later = event(store, SUPER, "tenant-root", {
    action: "open",
    eventId: "fixture-later-event",
    occurredAt: "2026-10-21T00:00:00Z",
  });
  assert.equal(later.ok, true);
  assert.equal(later.snapshot.rate, "800");
  assert.equal(later.amount, "800");
  assert.equal(within.snapshot.rate, "500");
});

test("excluded orders and unauthorized actors produce no commission", () => {
  const store = tree();
  const pending = defineCommissionPlan(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    planId: "fixture-pending",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    basis: "subscription",
    rate: "1000",
    rateCap: "4000",
    parentShare: "5000",
    childShare: "4000",
    platformShare: "1000",
    effectiveFrom: FROM,
    effectiveTo: TO,
    currency: "USDT",
    hold: false,
    refund: "adjusted",
    reversal: "reversed",
    requiredApprovers: [{ id: SUPER_2.id, role: "Super Admin" }],
    changedAt: CHANGED,
  });
  assert.equal(pending.ok, true, pending.error);
  const early = event(store, SUPER, "tenant-root", { eventId: "fixture-pending-event" });
  assert.equal(early.error, "plan is not in effect");
  assert.equal(early.amount, null);

  const rejected = event(store, SUPER, "tenant-root", { orderStatus: "rejected" });
  assert.equal(rejected.error, "order is excluded");
  assert.equal(rejected.amount, null);
  const cancelled = event(store, SUPER, "tenant-root", { orderStatus: "cancelled" });
  assert.equal(cancelled.error, "order is excluded");
  const self = event(store, SUPER, "tenant-root", {
    customerId: "fixture-same",
    beneficiaryId: "fixture-same",
  });
  assert.equal(self.error, "self-referral is not allowed");
  const customer = event(store, CUSTOMER, "tenant-a-child");
  assert.equal(customer.error, "role scope denied");
  const distributor = event(store, DIST, "tenant-a-child");
  assert.equal(distributor.error, "role scope denied");
  const outside = event(store, ADMIN, "tenant-b");
  assert.equal(outside.error, "tenant is outside subtree");
  const permission = event(store, SUPER, "tenant-root", { permission: "checklist.write" });
  assert.equal(permission.error, "permission is not granted");
  const secret = quiet(calculateCommission(store, {
    actor: SUPER,
    tenantId: "tenant-root",
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    eventId: "bearer fixture-token",
    occurredAt: WHEN,
    fee: "10000",
    refund: "0",
    exclusions: [],
    currency: "USDT",
    orderStatus: "settled",
    customerId: "fixture-customer-payee",
    beneficiaryId: "fixture-beneficiary",
    credential: "fixture-credential",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);
  assert.equal(store.plans.find((row) => row.planId === "fixture-pending").rate, "1000");

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/commission-calculation.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("Math.round"), false);
  assert.equal(source.includes("half-up"), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  for (const name of ROLE_NAMES) assert.equal(PERMISSION_MATRIX[name].length, 0);
  assert.equal(catalogGrants("Admin").length, 0);
  assert.deepEqual(Object.keys(calculationApi).sort(), [
    "COMMISSION_CALCULATION_LIMITATIONS",
    "calculateCommission",
  ]);
  assert.equal(COMMISSION_CALCULATION_LIMITATIONS.includes("a remainder is not rounded"), true);
  assert.equal(COMMISSION_CALCULATION_LIMITATIONS.includes("ledger entries are not written"), true);
  assert.equal(authorizeShell(CUSTOMER, "tenant-a-child").editChecklist, false);
});
