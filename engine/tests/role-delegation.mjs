import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { PERMISSION_MATRIX, ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import {
  DELEGATION_LIMITATIONS,
  createDelegationStore,
  delegateRole,
  grantSeatCapability,
  registerDelegationTenant,
} from "../services/role-delegation.mjs";
import * as delegationApi from "../services/role-delegation.mjs";
import { authorizeShell } from "../services/shell-capabilities.mjs";

const SUPER = { id: "fixture-super", role: "Super Admin", tenantId: "tenant-root" };
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
  assert.equal(body.includes("Retailer+Customer"), false);
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveEnabled, false);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.credentialStored, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.liveTrading, health.liveTrading);
  assert.equal(result.liveOrdersLocked, health.liveOrdersLocked);
  return result;
}

function tree() {
  const store = createDelegationStore();
  const root = registerDelegationTenant(store, { actor: SUPER, tenantId: "tenant-root", parentId: null });
  assert.equal(root.ok, true);
  for (const [tenantId, parentId] of [
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

function seat(store, actor, tenantId, role, subjectId, extra = {}) {
  return quiet(delegateRole(store, {
    actor,
    tenantId,
    role,
    subjectId,
    changedAt: "2026-10-07T00:00:00Z",
    ...extra,
  }));
}

test("a child cannot grant an upstream or sibling role outside its subtree", () => {
  const store = tree();
  const adminDenied = quiet(registerDelegationTenant(store, {
    actor: ADMIN,
    tenantId: "tenant-admin",
    parentId: "tenant-a",
  }));
  assert.equal(adminDenied.error, "role scope denied");
  assert.equal(store.tenants.has("tenant-admin"), false);

  const adminSeat = seat(store, SUPER, "tenant-a", "Admin", ADMIN.id);
  assert.equal(adminSeat.ok, true);
  assert.equal(store.assignments[0].role, "Admin");
  const upstream = seat(store, SUPER, "tenant-root", "Super Admin", "fixture-other-super");
  assert.equal(upstream.error, "role is not a descendant");
  const plan = seat(store, SUPER, "tenant-a", "Distributor", "fixture-plan");
  assert.equal(plan.error, "role is not a descendant");
  assert.equal(store.assignments.length, 1);

  const siblingAdmin = seat(store, ADMIN, "tenant-a", "Admin", "fixture-admin-2");
  assert.equal(siblingAdmin.error, "role is not a descendant");
  const above = seat(store, ADMIN, "tenant-a", "Super Admin", "fixture-escalation");
  assert.equal(above.error, "role is not a descendant");
  const superDist = seat(store, ADMIN, "tenant-a", "Super Distributor", SUPER_DIST.id);
  assert.equal(superDist.error, "role is not a descendant");
  const customerFromAdmin = seat(store, ADMIN, "tenant-a", "Customer", "fixture-direct-customer");
  assert.equal(customerFromAdmin.error, "role is not a descendant");
  const outside = seat(store, ADMIN, "tenant-b", "Distributor", "fixture-outside");
  assert.equal(outside.error, "tenant is outside subtree");
  assert.equal(store.assignments.length, 1);

  const distributor = seat(store, ADMIN, "tenant-a-child", "Distributor", DIST.id);
  assert.equal(distributor.ok, true);
  const retailer = seat(store, ADMIN, "tenant-a", "Retailer", RETAILER.id);
  assert.equal(retailer.ok, true);
  const fromSuperDist = seat(store, SUPER_DIST, "tenant-a", "Distributor", "fixture-from-super-dist");
  assert.equal(fromSuperDist.error, "role is not a descendant");
  assert.equal(store.assignments.length, 3);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});

test("a granted seat cannot exceed the empty catalog or the recorded capability", () => {
  const store = tree();
  seat(store, SUPER, "tenant-a", "Admin", ADMIN.id);
  seat(store, ADMIN, "tenant-a-child", "Distributor", DIST.id);
  const before = store.assignments.length;

  const early = seat(store, DIST, "tenant-a-child", "Retailer", "fixture-early-retailer");
  assert.equal(early.error, "capability is not granted");
  const earlyCustomer = seat(store, DIST, "tenant-a-child", "Customer", "fixture-early-customer");
  assert.equal(earlyCustomer.error, "capability is not granted");
  const customerGrant = quiet(grantSeatCapability(store, {
    actor: CUSTOMER,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(customerGrant.error, "capability grantor is not configured");
  const retailerGrant = quiet(grantSeatCapability(store, {
    actor: RETAILER,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(retailerGrant.error, "capability grantor is not configured");
  const superGrant = quiet(grantSeatCapability(store, {
    actor: SUPER,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(superGrant.error, "capability grantor is not configured");
  assert.equal(store.capabilities.length, 0);

  const outsideGrant = quiet(grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-b",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(outsideGrant.error, "tenant is outside subtree");
  const granted = quiet(grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(granted.ok, true);
  const replay = quiet(grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(replay.idempotentReplay, true);
  const again = quiet(grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T02:00:00Z",
  }));
  assert.equal(again.error, "capability is already recorded");
  assert.equal(store.capabilities.length, 1);

  const childRetailer = seat(store, DIST, "tenant-a-child", "Retailer", "fixture-child-retailer");
  assert.equal(childRetailer.ok, true);
  const childCustomer = seat(store, DIST, "tenant-a-child", "Customer", CUSTOMER.id);
  assert.equal(childCustomer.ok, true);
  const siblingSeat = seat(store, DIST, "tenant-b", "Customer", "fixture-sibling-customer");
  assert.equal(siblingSeat.error, "tenant is outside subtree");
  const parentSeat = seat(store, DIST, "tenant-a", "Customer", "fixture-parent-customer");
  assert.equal(parentSeat.error, "tenant is outside subtree");
  const upstream = seat(store, DIST, "tenant-a-child", "Admin", "fixture-dist-admin");
  assert.equal(upstream.error, "role is not a descendant");
  const siblingRole = seat(store, DIST, "tenant-a-child", "Distributor", "fixture-dist-2");
  assert.equal(siblingRole.error, "role is not a descendant");
  const second = seat(store, DIST, "tenant-a-child", "Retailer", CUSTOMER.id, {
    changedAt: "2026-10-07T03:00:00Z",
  });
  assert.equal(second.error, "role is already recorded");
  assert.equal(store.assignments.length, before + 2);

  const permission = seat(store, ADMIN, "tenant-a", "Retailer", "fixture-permission", {
    permission: "checklist.write",
  });
  assert.equal(permission.error, "permission is not granted");
  assert.equal(store.assignments.length, before + 2);
  for (const name of ROLE_NAMES) assert.deepEqual([...catalogGrants(name)], []);
  assert.equal(PERMISSION_MATRIX.Admin.length, 0);
  assert.equal(authorizeShell(CUSTOMER, "tenant-a-child").editChecklist, false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});

test("resource-owner and unknown roles store nothing", () => {
  const store = tree();
  seat(store, SUPER, "tenant-a", "Admin", ADMIN.id);
  seat(store, ADMIN, "tenant-a-child", "Retailer", RETAILER.id);
  const retailerCustomer = seat(store, RETAILER, "tenant-a-child", "Customer", "fixture-retailer-customer");
  assert.equal(retailerCustomer.error, "capability grantor is not configured");
  const retailerGrant = quiet(grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    subjectId: RETAILER.id,
    changedAt: "2026-10-07T01:00:00Z",
  }));
  assert.equal(retailerGrant.error, "capability grantor is not configured");
  const customer = seat(store, CUSTOMER, "tenant-a-child", "Customer", "fixture-customer-2");
  assert.equal(customer.error, "role is not a descendant");
  const combined = seat(store, ADMIN, "tenant-a", "Retailer+Customer", "fixture-combined");
  assert.equal(combined.error, "role scope denied");
  const owner = seat(store, ADMIN, "tenant-a", "Retailer", "fixture-owned", {
    ownerId: "fixture-other-owner",
  });
  assert.equal(owner.error, "resource owner is outside scope");
  const secret = quiet(delegateRole(store, {
    actor: ADMIN,
    tenantId: "tenant-a",
    role: "Retailer",
    subjectId: "bearer fixture-token",
    changedAt: "2026-10-07T04:00:00Z",
    credential: "fixture-credential",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(store.capabilities.length, 0);
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/role-delegation.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  assert.deepEqual(Object.keys(delegationApi).sort(), [
    "DELEGATION_LIMITATIONS",
    "createDelegationStore",
    "delegateRole",
    "grantSeatCapability",
    "registerDelegationTenant",
  ]);
  assert.equal(DELEGATION_LIMITATIONS.includes("Super Distributor descendants are NOT IN SOURCE"), true);
  assert.equal(DELEGATION_LIMITATIONS.includes("Retailer seat-creation grantor is NOT IN SOURCE"), true);
  assert.equal(authorizeShell({ id: "customer", role: "Customer", tenantId: 1 }, 1).editChecklist, false);
});
