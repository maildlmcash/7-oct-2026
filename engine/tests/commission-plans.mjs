import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { PERMISSION_MATRIX, ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import {
  COMMISSION_PLAN_LIMITATIONS,
  approveCommissionPlan,
  createCommissionStore,
  defineCommissionPlan,
} from "../services/commission-plans.mjs";
import * as commissionApi from "../services/commission-plans.mjs";
import { registerDelegationTenant } from "../services/role-delegation.mjs";
import { authorizeShell } from "../services/shell-capabilities.mjs";

const CHANGED = "2026-10-07T00:00:00Z";
const FROM = "2026-10-08T00:00:00Z";
const TO = "2026-10-20T00:00:00Z";
const SUPER = { id: "fixture-super", role: "Super Admin", tenantId: "tenant-root" };
const SUPER_2 = { id: "fixture-super-2", role: "Super Admin", tenantId: "tenant-root" };
const SUPER_3 = { id: "fixture-super-3", role: "Super Admin", tenantId: "tenant-root" };
const ADMIN = { id: "fixture-admin", role: "Admin", tenantId: "tenant-a" };
const SUPER_DIST = { id: "fixture-super-dist", role: "Super Distributor", tenantId: "tenant-a" };
const DIST = { id: "fixture-dist", role: "Distributor", tenantId: "tenant-a-child" };
const RETAILER = { id: "fixture-retailer", role: "Retailer", tenantId: "tenant-a-child" };
const CUSTOMER = { id: "fixture-customer", role: "Customer", tenantId: "tenant-a-child" };

function quiet(result) {
  const body = JSON.stringify(result);
  assert.equal(body.includes("bearer fixture-token"), false);
  assert.equal(body.includes("fixture-credential"), false);
  assert.equal(body.includes("checklist.write"), false);
  assert.equal(body.includes("notional"), false);
  assert.equal(body.includes("unrealized"), false);
  assert.equal(body.includes("paper profit"), false);
  assert.equal(body.includes("-1"), false);
  assert.equal(body.includes("10001"), false);
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
    ["tenant-other", null],
    ["tenant-a", "tenant-root"],
    ["tenant-b", "tenant-root"],
    ["tenant-a-child", "tenant-a"],
  ]) {
    const row = registerDelegationTenant(store, { actor: SUPER, tenantId, parentId });
    assert.equal(row.ok, true, row.error);
  }
  return store;
}

function fields(extra = {}) {
  return {
    product: "distributor",
    action: "share",
    eligibleRole: "Distributor",
    basis: "realized net positive pnl",
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
  };
}

function define(store, actor, tenantId, planId, extra = {}) {
  return quiet(defineCommissionPlan(store, {
    actor,
    tenantId,
    planId,
    ...fields(extra),
  }));
}

function approve(store, actor, tenantId, planId, changedAt = CHANGED) {
  return quiet(approveCommissionPlan(store, { actor, tenantId, planId, changedAt }));
}

function planOf(store, planId) {
  return store.plans.find((row) => row.planId === planId);
}

test("unauthorized roles cannot edit a plan and out-of-range rates are not stored", () => {
  const store = tree();
  const before = store.plans.length;
  for (const actor of [CUSTOMER, RETAILER, DIST, SUPER_DIST]) {
    const denied = define(store, actor, "tenant-a-child", "fixture-denied", { rate: "10001" });
    assert.equal(denied.error, "role scope denied");
  }
  const outside = define(store, ADMIN, "tenant-b", "fixture-outside");
  assert.equal(outside.error, "tenant is outside subtree");
  const apiPlan = define(store, ADMIN, "tenant-a", "fixture-api", {
    product: "api",
    action: "subscription",
    eligibleRole: "Admin",
    basis: "subscription",
  });
  assert.equal(apiPlan.error, "role scope denied");
  const adminProduct = define(store, ADMIN, "tenant-a", "fixture-admin-product", {
    product: "admin",
    eligibleRole: "Admin",
  });
  assert.equal(adminProduct.error, "role scope denied");
  const noCeiling = define(store, ADMIN, "tenant-a-child", "fixture-no-ceiling");
  assert.equal(noCeiling.error, "ceiling is not configured");
  assert.equal(store.plans.length, before);

  const ceiling = define(store, SUPER, "tenant-root", "fixture-ceiling");
  assert.equal(ceiling.ok, true);
  assert.equal(ceiling.planStatus, "pending");
  const maker = approve(store, SUPER, "tenant-root", "fixture-ceiling");
  assert.equal(maker.error, "maker cannot approve");
  assert.equal(planOf(store, "fixture-ceiling").status, "pending");
  const approved = approve(store, SUPER_2, "tenant-root", "fixture-ceiling");
  assert.equal(approved.ok, true);
  assert.equal(approved.planStatus, "approved");
  const storedCeiling = planOf(store, "fixture-ceiling");
  assert.equal(storedCeiling.basis, "realized net positive pnl");
  assert.equal(storedCeiling.rate, "1000");
  assert.equal(storedCeiling.rateCap, "4000");
  assert.equal(storedCeiling.currency, "USDT");
  assert.equal(storedCeiling.hold, true);
  assert.equal(storedCeiling.refund, "reversed");
  assert.equal(storedCeiling.reversal, "adjusted");
  assert.equal(storedCeiling.eligibleRole, "Distributor");
  assert.equal(storedCeiling.amount, undefined);

  const overCap = define(store, ADMIN, "tenant-a-child", "fixture-over-cap", { rate: "4001" });
  assert.equal(overCap.error, "rate exceeds cap");
  const overPool = define(store, ADMIN, "tenant-a-child", "fixture-over-pool", {
    parentShare: "5000",
    childShare: "4000",
    platformShare: "2000",
  });
  assert.equal(overPool.error, "allocation exceeds pool");
  const overBound = define(store, SUPER, "tenant-root", "fixture-over-bound", { rateCap: "10001", rate: "1000" });
  assert.equal(overBound.error, "rate is out of range");
  const negative = define(store, ADMIN, "tenant-a-child", "fixture-negative", { rate: "-1" });
  assert.equal(negative.error, "rate is out of range");
  const missingRate = define(store, ADMIN, "tenant-a-child", "fixture-missing-rate", { rate: "" });
  assert.equal(missingRate.error, "rate is not configured");
  const aboveParent = define(store, ADMIN, "tenant-a-child", "fixture-above-parent", { rateCap: "4001", rate: "1000" });
  assert.equal(aboveParent.error, "child exceeds parent ceiling");
  const notional = define(store, ADMIN, "tenant-a-child", "fixture-notional", { basis: "notional volume" });
  assert.equal(notional.error, "basis is not approved");
  const unrealized = define(store, ADMIN, "tenant-a-child", "fixture-unrealized", { basis: "unrealized" });
  assert.equal(unrealized.error, "basis is not approved");
  const paper = define(store, ADMIN, "tenant-a-child", "fixture-paper", { action: "paper profit" });
  assert.equal(paper.error, "action is not approved");
  const customerPay = define(store, SUPER, "tenant-root", "fixture-customer-pay", {
    product: "customer",
    eligibleRole: "Customer",
    rate: "1",
    rateCap: "0",
    childShare: "0",
  });
  assert.equal(customerPay.error, "customer commission is not allowed");
  assert.equal(store.plans.some((row) => row.planId.startsWith("fixture-over") || row.planId.startsWith("fixture-notional")), false);
  assert.equal(JSON.stringify(store).includes("notional"), false);
  assert.equal(JSON.stringify(store).includes("10001"), false);
  assert.equal(store.plans.some((row) => row.rate === "-1"), false);

  const child = define(store, ADMIN, "tenant-a-child", "fixture-child", { rate: "500", rateCap: "4000" });
  assert.equal(child.ok, true);
  assert.equal(child.planStatus, "pending");
  assert.equal(approve(store, ADMIN, "tenant-a-child", "fixture-child").error, "role scope denied");
  assert.equal(approve(store, SUPER_2, "tenant-a-child", "fixture-child").planStatus, "approved");
  assert.equal(planOf(store, "fixture-child").rate, "500");
  assert.equal(planOf(store, "fixture-child").status, "approved");

  const customerCeiling = define(store, SUPER, "tenant-root", "fixture-customer-ceiling", {
    product: "customer",
    action: "share",
    eligibleRole: "Customer",
    rate: "0",
    rateCap: "0",
    parentShare: "0",
    childShare: "0",
    platformShare: "0",
  });
  assert.equal(customerCeiling.ok, true);
  assert.equal(approve(store, SUPER_2, "tenant-root", "fixture-customer-ceiling").planStatus, "approved");
  const customerPlan = define(store, ADMIN, "tenant-a", "fixture-customer-zero", {
    product: "customer",
    eligibleRole: "Customer",
    rate: "0",
    rateCap: "0",
    parentShare: "0",
    childShare: "0",
    platformShare: "0",
  });
  assert.equal(customerPlan.ok, true);
  assert.equal(planOf(store, "fixture-customer-zero").rate, "0");
  assert.equal(catalogGrants("Admin").length, 0);
  assert.equal(authorizeShell(CUSTOMER, "tenant-a-child").editChecklist, false);
});

test("overlapping and retroactive periods do not replace an existing plan", () => {
  const store = tree();
  assert.equal(define(store, SUPER, "tenant-root", "fixture-ceiling").ok, true);
  assert.equal(approve(store, SUPER_2, "tenant-root", "fixture-ceiling").planStatus, "approved");
  const first = define(store, ADMIN, "tenant-a-child", "fixture-period", {
    effectiveFrom: "2026-10-08T00:00:00Z",
    effectiveTo: "2026-10-15T00:00:00Z",
  });
  assert.equal(first.ok, true);
  const replay = define(store, ADMIN, "tenant-a-child", "fixture-period", {
    effectiveFrom: "2026-10-08T00:00:00Z",
    effectiveTo: "2026-10-15T00:00:00Z",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.plans.filter((row) => row.planId === "fixture-period").length, 1);

  const overlap = define(store, ADMIN, "tenant-a-child", "fixture-overlap", {
    effectiveFrom: "2026-10-14T00:00:00Z",
    effectiveTo: "2026-10-18T00:00:00Z",
    changedAt: "2026-10-07T00:00:00Z",
  });
  assert.equal(overlap.error, "period overlaps an active plan");
  assert.equal(planOf(store, "fixture-period").rate, "1000");
  assert.equal(planOf(store, "fixture-overlap"), undefined);

  const edited = define(store, ADMIN, "tenant-a-child", "fixture-period", {
    rate: "900",
    changedAt: "2026-10-07T01:00:00Z",
    effectiveFrom: "2026-10-08T00:00:00Z",
    effectiveTo: "2026-10-15T00:00:00Z",
  });
  assert.equal(edited.error, "period overlaps an active plan");
  assert.equal(planOf(store, "fixture-period").rate, "1000");

  const retro = define(store, ADMIN, "tenant-a-child", "fixture-retro", {
    changedAt: "2026-10-09T00:00:00Z",
    effectiveFrom: "2026-10-08T00:00:00Z",
    effectiveTo: "2026-10-21T00:00:00Z",
  });
  assert.equal(retro.error, "rate change is retroactive");
  const invalid = define(store, ADMIN, "tenant-a-child", "fixture-invalid", {
    effectiveFrom: "2026-10-18T00:00:00Z",
    effectiveTo: "2026-10-18T00:00:00Z",
  });
  assert.equal(invalid.error, "period is not valid");
  const badStamp = define(store, ADMIN, "tenant-a-child", "fixture-stamp", {
    effectiveFrom: "tomorrow",
  });
  assert.equal(badStamp.error, "effective time is not configured");

  const next = define(store, ADMIN, "tenant-a-child", "fixture-next", {
    changedAt: "2026-10-07T02:00:00Z",
    effectiveFrom: "2026-10-15T00:00:00Z",
    effectiveTo: "2026-10-25T00:00:00Z",
    rate: "800",
  });
  assert.equal(next.ok, true);
  assert.equal(next.planStatus, "pending");
  assert.equal(planOf(store, "fixture-next").effectiveFrom, "2026-10-15T00:00:00Z");
  assert.equal(planOf(store, "fixture-period").status, "pending");
  assert.equal(store.plans.filter((row) => row.tenantId === "tenant-a-child" && row.product === "distributor").length, 2);
});

test("required approvers stay explicit and secrets are not stored", () => {
  const store = tree();
  assert.equal(define(store, SUPER, "tenant-root", "fixture-ceiling").ok, true);
  assert.equal(approve(store, SUPER_2, "tenant-root", "fixture-ceiling").planStatus, "approved");

  const empty = define(store, ADMIN, "tenant-a-child", "fixture-empty-approver", { requiredApprovers: [] });
  assert.equal(empty.error, "approver is not configured");
  const self = define(store, ADMIN, "tenant-a-child", "fixture-self", {
    requiredApprovers: [{ id: ADMIN.id, role: "Super Admin" }],
  });
  assert.equal(self.error, "maker cannot approve");
  const wrongRole = define(store, ADMIN, "tenant-a-child", "fixture-wrong-role", {
    requiredApprovers: [{ id: SUPER_2.id, role: "Admin" }],
  });
  assert.equal(wrongRole.error, "role scope denied");
  const duplicate = define(store, ADMIN, "tenant-a-child", "fixture-duplicate", {
    requiredApprovers: [
      { id: SUPER_2.id, role: "Super Admin" },
      { id: SUPER_2.id, role: "Super Admin" },
    ],
  });
  assert.equal(duplicate.error, "approvers are not distinct");
  assert.equal(store.plans.some((row) => row.planId === "fixture-duplicate"), false);

  const two = define(store, ADMIN, "tenant-a-child", "fixture-two", {
    requiredApprovers: [
      { id: SUPER_2.id, role: "Super Admin" },
      { id: SUPER_3.id, role: "Super Admin" },
    ],
  });
  assert.equal(two.ok, true);
  const firstApproval = approve(store, SUPER_2, "tenant-a-child", "fixture-two");
  assert.equal(firstApproval.planStatus, "pending");
  assert.equal(planOf(store, "fixture-two").status, "pending");
  const stranger = approve(store, SUPER, "tenant-a-child", "fixture-two");
  assert.equal(stranger.error, "approver is not recorded");
  assert.equal(store.approvals.filter((row) => row.planId === "fixture-two").length, 1);
  const replay = approve(store, SUPER_2, "tenant-a-child", "fixture-two");
  assert.equal(replay.idempotentReplay, true);
  const secondApproval = approve(store, SUPER_3, "tenant-a-child", "fixture-two");
  assert.equal(secondApproval.planStatus, "approved");
  assert.equal(planOf(store, "fixture-two").status, "approved");
  assert.equal(planOf(store, "fixture-two").requiredApprovers.length, 2);

  const missing = approve(store, SUPER_2, "tenant-a-child", "fixture-absent");
  assert.equal(missing.error, "plan is not recorded");
  const hold = define(store, ADMIN, "tenant-a-child", "fixture-hold", { hold: "30" });
  assert.equal(hold.error, "hold is not configured");
  const percent = define(store, ADMIN, "tenant-a-child", "fixture-percent", { percent: "30" });
  assert.equal(percent.error, "unsupported field");
  const permission = define(store, ADMIN, "tenant-a-child", "fixture-permission", { permission: "checklist.write" });
  assert.equal(permission.error, "permission is not granted");
  const secret = quiet(defineCommissionPlan(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    planId: "bearer fixture-token",
    ...fields(),
    credential: "fixture-credential",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);
  assert.equal(JSON.stringify(store).includes("checklist.write"), false);
  assert.equal(store.plans.some((row) => row.planId === "fixture-percent" || row.planId === "fixture-hold"), false);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/commission-plans.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("30%"), false);
  assert.equal(source.includes("100%"), false);
  assert.equal(source.includes("0.15"), false);
  assert.equal(/rate\s*=\s*["']?\d/.test(source), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  for (const name of ROLE_NAMES) {
    assert.equal(PERMISSION_MATRIX[name].length, 0);
  }
  assert.deepEqual(Object.keys(commissionApi).sort(), [
    "COMMISSION_PLAN_LIMITATIONS",
    "approveCommissionPlan",
    "createCommissionStore",
    "defineCommissionPlan",
  ]);
  assert.equal(COMMISSION_PLAN_LIMITATIONS.includes("rates are caller-supplied basis points"), true);
  assert.equal(COMMISSION_PLAN_LIMITATIONS.includes("commission amounts are not calculated"), true);
  assert.equal(COMMISSION_PLAN_LIMITATIONS.includes("hold duration is NOT IN SOURCE"), true);
  assert.equal(authorizeShell({ id: "customer", role: "Customer", tenantId: 1 }, 1).editChecklist, false);
});
