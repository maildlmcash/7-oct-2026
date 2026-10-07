import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { PERMISSION_MATRIX, ROLE_NAMES, catalogGrants } from "../packages/contracts/src/roles.mjs";
import {
  createDelegationStore,
  grantSeatCapability,
  registerDelegationTenant,
} from "../services/role-delegation.mjs";
import * as delegationApi from "../services/role-delegation.mjs";
import {
  PROFILE_LIMITATIONS,
  assignProfile,
  createProfileStore,
  readProfileResource,
  recordProfileResource,
  removeProfile,
} from "../services/role-profiles.mjs";
import * as profileApi from "../services/role-profiles.mjs";
import { authorizeShell } from "../services/shell-capabilities.mjs";

const CHANGED = "2026-10-07T00:00:00Z";
const SUPER = { id: "fixture-super", role: "Super Admin", tenantId: "tenant-root" };
const ADMIN = { id: "fixture-admin", role: "Admin", tenantId: "tenant-a" };
const ADMIN_B = { id: "fixture-admin-b", role: "Admin", tenantId: "tenant-b" };
const DIST = { id: "fixture-dist", role: "Distributor", tenantId: "tenant-a-child" };
const ONLY_RETAILER = { id: "fixture-only-retailer", role: "Retailer", tenantId: "tenant-a-child" };
const ONLY_CUSTOMER = { id: "fixture-only-customer", role: "Customer", tenantId: "tenant-a-child" };
const BOTH = { id: "fixture-both", role: "Customer", tenantId: "tenant-a-child" };
const BOTH_AS_RETAILER = { id: "fixture-both", role: "Retailer", tenantId: "tenant-a-child" };
const BOTH_REVERSE = { id: "fixture-both-reverse", role: "Retailer", tenantId: "tenant-a-child" };
const RETAILER_2 = { id: "fixture-retailer-2", role: "Retailer", tenantId: "tenant-a-child" };
const CUSTOMER_2 = { id: "fixture-customer-2", role: "Customer", tenantId: "tenant-a-child" };
const RETAILER_B = { id: "fixture-retailer-b", role: "Retailer", tenantId: "tenant-b" };

function quiet(result) {
  const body = JSON.stringify(result);
  assert.equal(body.includes("bearer fixture-token"), false);
  assert.equal(body.includes("fixture-credential"), false);
  assert.equal(body.includes("checklist.write"), false);
  assert.equal(body.includes("Retailer+Customer"), false);
  assert.equal(body.includes("fixture-rate"), false);
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

function rolesOf(store, subjectId) {
  return store.profiles.filter((row) => row.subjectId === subjectId).map((row) => row.role);
}

function assignmentOf(store, subjectId) {
  return store.assignments.find((row) => row.subjectId === subjectId);
}

function ownerOf(store, resourceId) {
  return store.resources.find((row) => row.resourceId === resourceId);
}

function tree() {
  const store = createProfileStore();
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

function seat(store, actor, tenantId, role, subjectId, extra = {}) {
  return quiet(assignProfile(store, {
    actor,
    tenantId,
    role,
    subjectId,
    changedAt: CHANGED,
    ...extra,
  }));
}

function prepared() {
  const store = tree();
  assert.equal(seat(store, SUPER, "tenant-a", "Admin", ADMIN.id).ok, true);
  assert.equal(seat(store, SUPER, "tenant-b", "Admin", ADMIN_B.id).ok, true);
  assert.equal(seat(store, ADMIN, "tenant-a-child", "Distributor", DIST.id).ok, true);
  const granted = grantSeatCapability(store, {
    actor: ADMIN,
    tenantId: "tenant-a-child",
    subjectId: DIST.id,
    changedAt: "2026-10-07T01:00:00Z",
  });
  assert.equal(granted.ok, true, granted.error);
  assert.equal(seat(store, ADMIN_B, "tenant-b", "Retailer", RETAILER_B.id).ok, true);
  return store;
}

test("separate identities keep one profile and reject every other pair", () => {
  const plain = createDelegationStore();
  const plainDenied = quiet(assignProfile(plain, {
    actor: DIST,
    tenantId: "tenant-a-child",
    role: "Retailer",
    subjectId: ONLY_RETAILER.id,
    changedAt: CHANGED,
  }));
  assert.equal(plainDenied.error, "unsupported field");
  assert.equal(plain.assignments.length, 0);

  const store = prepared();
  const retailer = seat(store, DIST, "tenant-a-child", "Retailer", ONLY_RETAILER.id);
  assert.equal(retailer.ok, true);
  const customer = seat(store, DIST, "tenant-a-child", "Customer", ONLY_CUSTOMER.id);
  assert.equal(customer.ok, true);
  assert.deepEqual(rolesOf(store, ONLY_RETAILER.id), ["Retailer"]);
  assert.deepEqual(rolesOf(store, ONLY_CUSTOMER.id), ["Customer"]);
  assert.equal(assignmentOf(store, ONLY_RETAILER.id).role, "Retailer");
  assert.equal(assignmentOf(store, ONLY_CUSTOMER.id).role, "Customer");

  const replay = seat(store, DIST, "tenant-a-child", "Retailer", ONLY_RETAILER.id);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(rolesOf(store, ONLY_RETAILER.id).length, 1);

  const again = quiet(assignProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    role: "Retailer",
    subjectId: ONLY_RETAILER.id,
    changedAt: "2026-10-07T03:00:00Z",
  }));
  assert.equal(again.error, "profile is already recorded");
  assert.equal(rolesOf(store, ONLY_RETAILER.id).length, 1);

  const asAdmin = seat(store, SUPER, "tenant-a-child", "Admin", ONLY_RETAILER.id);
  assert.equal(asAdmin.error, "profile is not combined");
  const asDistributor = seat(store, ADMIN, "tenant-a-child", "Distributor", ONLY_RETAILER.id);
  assert.equal(asDistributor.error, "profile is not combined");
  const directCustomer = seat(store, ADMIN, "tenant-a-child", "Customer", "fixture-admin-customer");
  assert.equal(directCustomer.error, "role is not a descendant");
  assert.equal(store.profiles.some((row) => row.subjectId === "fixture-admin-customer"), false);
  const namedCombined = seat(store, DIST, "tenant-a-child", "Retailer+Customer", "fixture-combined-name");
  assert.equal(namedCombined.error, "role scope denied");
  assert.equal(store.profiles.some((row) => row.subjectId === "fixture-combined-name"), false);

  const retailerBook = quiet(recordProfileResource(store, {
    actor: ONLY_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-separate-retailer",
    changedAt: CHANGED,
  }));
  assert.equal(retailerBook.ok, true);
  assert.equal(retailerBook.ownerSubjectId, ONLY_RETAILER.id);
  const customerBook = quiet(recordProfileResource(store, {
    actor: ONLY_CUSTOMER,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-separate-customer",
    changedAt: CHANGED,
  }));
  assert.equal(customerBook.ok, true);
  const crossRetail = quiet(readProfileResource(store, {
    actor: ONLY_CUSTOMER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-separate-retailer",
  }));
  assert.equal(crossRetail.error, "profile is not held");
  const crossCustomer = quiet(readProfileResource(store, {
    actor: ONLY_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-separate-customer",
  }));
  assert.equal(crossCustomer.error, "profile is not held");
  assert.equal(ownerOf(store, "fixture-separate-retailer").ownerSubjectId, ONLY_RETAILER.id);
  assert.equal(ownerOf(store, "fixture-separate-customer").ownerSubjectId, ONLY_CUSTOMER.id);
  assert.equal(JSON.stringify(store).includes("Retailer+Customer"), false);
});

test("one subject can hold Retailer and Customer while each profile stays isolated", () => {
  const store = prepared();
  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", BOTH.id).ok, true);
  const customerHalf = seat(store, DIST, "tenant-a-child", "Customer", BOTH.id);
  assert.equal(customerHalf.ok, true);
  assert.equal(customerHalf.idempotentReplay, false);
  assert.deepEqual(rolesOf(store, BOTH.id), ["Retailer", "Customer"]);
  assert.equal(assignmentOf(store, BOTH.id).role, "Retailer");
  assert.equal(store.assignments.filter((row) => row.subjectId === BOTH.id).length, 1);

  const customerReplay = seat(store, DIST, "tenant-a-child", "Customer", BOTH.id);
  assert.equal(customerReplay.idempotentReplay, true);
  assert.equal(rolesOf(store, BOTH.id).length, 2);
  const third = seat(store, ADMIN, "tenant-a-child", "Distributor", BOTH.id);
  assert.equal(third.error, "profile is not combined");
  assert.equal(rolesOf(store, BOTH.id).length, 2);

  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", BOTH_REVERSE.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", BOTH_REVERSE.id).ok, true);
  assert.deepEqual(rolesOf(store, BOTH_REVERSE.id), ["Customer", "Retailer"]);
  assert.equal(assignmentOf(store, BOTH_REVERSE.id).role, "Customer");

  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", ONLY_CUSTOMER.id).ok, true);
  const mismatched = seat(store, ADMIN_B, "tenant-b", "Retailer", ONLY_CUSTOMER.id);
  assert.equal(mismatched.error, "profile is not combined");
  assert.deepEqual(rolesOf(store, ONLY_CUSTOMER.id), ["Customer"]);
  assert.equal(assignmentOf(store, ONLY_CUSTOMER.id).tenantId, "tenant-a-child");

  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", RETAILER_2.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", CUSTOMER_2.id).ok, true);

  const retailBook = quiet(recordProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-both-retailer",
    changedAt: CHANGED,
  }));
  assert.equal(retailBook.ok, true);
  assert.equal(retailBook.profile, "Retailer");
  const customerBook = quiet(recordProfileResource(store, {
    actor: BOTH,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-both-customer",
    changedAt: CHANGED,
  }));
  assert.equal(customerBook.ok, true);
  const otherRetailBook = quiet(recordProfileResource(store, {
    actor: RETAILER_2,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-retailer-2-book",
    changedAt: CHANGED,
  }));
  assert.equal(otherRetailBook.ok, true);
  const otherCustomerBook = quiet(recordProfileResource(store, {
    actor: CUSTOMER_2,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-customer-2-book",
    changedAt: CHANGED,
  }));
  assert.equal(otherCustomerBook.ok, true);

  const customerReadsRetail = quiet(readProfileResource(store, {
    actor: BOTH,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-both-retailer",
  }));
  assert.equal(customerReadsRetail.error, "resource owner is outside scope");
  const retailReadsCustomer = quiet(readProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-both-customer",
  }));
  assert.equal(retailReadsCustomer.error, "resource owner is outside scope");
  const ownRetail = quiet(readProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-both-retailer",
  }));
  assert.equal(ownRetail.ok, true);
  assert.equal(ownRetail.ownerSubjectId, BOTH.id);
  const ownCustomer = quiet(readProfileResource(store, {
    actor: BOTH,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-both-customer",
  }));
  assert.equal(ownCustomer.ok, true);
  assert.equal(ownCustomer.profile, "Customer");

  const secondRetailer = quiet(readProfileResource(store, {
    actor: RETAILER_2,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-both-retailer",
  }));
  assert.equal(secondRetailer.error, "resource owner is outside scope");
  const secondCustomer = quiet(readProfileResource(store, {
    actor: CUSTOMER_2,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-both-customer",
  }));
  assert.equal(secondCustomer.error, "resource owner is outside scope");
  const retailerAsCustomer = quiet(readProfileResource(store, {
    actor: RETAILER_2,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-both-customer",
  }));
  assert.equal(retailerAsCustomer.error, "profile is not held");
  const customerAsRetailer = quiet(readProfileResource(store, {
    actor: CUSTOMER_2,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-both-retailer",
  }));
  assert.equal(customerAsRetailer.error, "profile is not held");
  const bothReadsOther = quiet(readProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-retailer-2-book",
  }));
  assert.equal(bothReadsOther.error, "resource owner is outside scope");

  const created = seat(store, BOTH_AS_RETAILER, "tenant-a-child", "Customer", "fixture-downstream");
  assert.equal(created.error, "capability grantor is not configured");
  assert.equal(store.profiles.some((row) => row.subjectId === "fixture-downstream"), false);
  const customerCreates = seat(store, BOTH, "tenant-a-child", "Retailer", "fixture-downstream");
  assert.equal(customerCreates.error, "role is not a descendant");
  const permission = seat(store, DIST, "tenant-a-child", "Customer", "fixture-permission", {
    permission: "checklist.write",
  });
  assert.equal(permission.error, "permission is not granted");
  assert.equal(store.profiles.some((row) => row.subjectId === "fixture-permission"), false);
  assert.equal(catalogGrants("Retailer").length, 0);
  assert.equal(catalogGrants("Customer").length, 0);
  assert.equal(authorizeShell({ id: "customer", role: "Customer", tenantId: 1 }, 1).editChecklist, false);
  assert.equal(ownerOf(store, "fixture-customer-2-book").ownerSubjectId, CUSTOMER_2.id);
});

test("role removal keeps ownership with a profile that still exists", () => {
  const store = prepared();
  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", BOTH.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", BOTH.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", BOTH_REVERSE.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", BOTH_REVERSE.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Retailer", RETAILER_2.id).ok, true);
  assert.equal(seat(store, DIST, "tenant-a-child", "Customer", CUSTOMER_2.id).ok, true);
  assert.equal(quiet(recordProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-owned-retailer",
    changedAt: CHANGED,
  })).ok, true);
  assert.equal(quiet(recordProfileResource(store, {
    actor: BOTH,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-owned-customer",
    changedAt: CHANGED,
  })).ok, true);
  assert.equal(quiet(recordProfileResource(store, {
    actor: BOTH_REVERSE,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-reverse-customer",
    changedAt: CHANGED,
  })).ok, true);
  assert.equal(quiet(recordProfileResource(store, {
    actor: RETAILER_2,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-kept-retailer",
    changedAt: CHANGED,
  })).ok, true);

  const profilesBefore = store.profiles.length;
  const resourcesBefore = store.resources.length;
  const orphan = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH.id,
    profile: "Retailer",
    changedAt: "2026-10-07T05:00:00Z",
  }));
  assert.equal(orphan.error, "ownership would be orphaned");
  assert.equal(store.profiles.length, profilesBefore);
  assert.equal(store.resources.length, resourcesBefore);
  assert.equal(ownerOf(store, "fixture-owned-retailer").ownerSubjectId, BOTH.id);
  assert.equal(assignmentOf(store, BOTH.id).role, "Retailer");
  assert.deepEqual(rolesOf(store, BOTH.id), ["Retailer", "Customer"]);

  const wrongProfile = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH.id,
    profile: "Retailer",
    successorId: CUSTOMER_2.id,
    changedAt: "2026-10-07T05:00:00Z",
  }));
  assert.equal(wrongProfile.error, "profile is not held");
  assert.equal(ownerOf(store, "fixture-owned-retailer").ownerSubjectId, BOTH.id);

  const otherTenant = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH.id,
    profile: "Retailer",
    successorId: RETAILER_B.id,
    changedAt: "2026-10-07T05:00:00Z",
  }));
  assert.equal(otherTenant.error, "tenant is outside subtree");
  assert.equal(ownerOf(store, "fixture-owned-retailer").ownerSubjectId, BOTH.id);
  assert.deepEqual(rolesOf(store, RETAILER_B.id), ["Retailer"]);

  const self = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH.id,
    profile: "Retailer",
    successorId: BOTH.id,
    changedAt: "2026-10-07T05:00:00Z",
  }));
  assert.equal(self.error, "resource owner is outside scope");
  assert.equal(rolesOf(store, BOTH.id).length, 2);

  const moved = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH.id,
    profile: "Retailer",
    successorId: RETAILER_2.id,
    changedAt: "2026-10-07T05:00:00Z",
  }));
  assert.equal(moved.ok, true);
  assert.deepEqual(rolesOf(store, BOTH.id), ["Customer"]);
  assert.equal(assignmentOf(store, BOTH.id).role, "Customer");
  assert.equal(ownerOf(store, "fixture-owned-retailer").ownerSubjectId, RETAILER_2.id);
  assert.equal(ownerOf(store, "fixture-owned-customer").ownerSubjectId, BOTH.id);
  const removedRead = quiet(readProfileResource(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-owned-retailer",
  }));
  assert.equal(removedRead.error, "profile is not held");
  const successorRead = quiet(readProfileResource(store, {
    actor: RETAILER_2,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-owned-retailer",
  }));
  assert.equal(successorRead.ok, true);
  assert.equal(successorRead.ownerSubjectId, RETAILER_2.id);
  const customerRemains = quiet(readProfileResource(store, {
    actor: BOTH,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-owned-customer",
  }));
  assert.equal(customerRemains.ok, true);
  const otherCustomer = quiet(readProfileResource(store, {
    actor: CUSTOMER_2,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-owned-customer",
  }));
  assert.equal(otherCustomer.error, "resource owner is outside scope");

  const empty = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH_REVERSE.id,
    profile: "Retailer",
    changedAt: "2026-10-07T06:00:00Z",
  }));
  assert.equal(empty.ok, true);
  assert.deepEqual(rolesOf(store, BOTH_REVERSE.id), ["Customer"]);
  assert.equal(assignmentOf(store, BOTH_REVERSE.id).role, "Customer");
  assert.equal(ownerOf(store, "fixture-reverse-customer").ownerSubjectId, BOTH_REVERSE.id);
  const emptyStillReads = quiet(readProfileResource(store, {
    actor: BOTH_REVERSE,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-reverse-customer",
  }));
  assert.equal(emptyStillReads.ok, true);
  const emptyRetail = quiet(readProfileResource(store, {
    actor: BOTH_REVERSE,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "fixture-reverse-customer",
  }));
  assert.equal(emptyRetail.error, "profile is not held");

  const customerOrphan = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH_REVERSE.id,
    profile: "Customer",
    changedAt: "2026-10-07T06:00:00Z",
  }));
  assert.equal(customerOrphan.error, "ownership would be orphaned");
  assert.equal(ownerOf(store, "fixture-reverse-customer").ownerSubjectId, BOTH_REVERSE.id);

  const customerMoved = quiet(removeProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    subjectId: BOTH_REVERSE.id,
    profile: "Customer",
    successorId: CUSTOMER_2.id,
    changedAt: "2026-10-07T07:00:00Z",
  }));
  assert.equal(customerMoved.ok, true);
  assert.equal(rolesOf(store, BOTH_REVERSE.id).length, 0);
  assert.equal(assignmentOf(store, BOTH_REVERSE.id), undefined);
  assert.equal(ownerOf(store, "fixture-reverse-customer").ownerSubjectId, CUSTOMER_2.id);
  assert.equal(ownerOf(store, "fixture-kept-retailer").ownerSubjectId, RETAILER_2.id);
  assert.deepEqual(rolesOf(store, RETAILER_2.id), ["Retailer"]);
  assert.deepEqual(rolesOf(store, CUSTOMER_2.id), ["Customer"]);
  const gone = quiet(readProfileResource(store, {
    actor: BOTH_REVERSE,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-reverse-customer",
  }));
  assert.equal(gone.error, "profile is not held");
  const received = quiet(readProfileResource(store, {
    actor: CUSTOMER_2,
    tenantId: "tenant-a-child",
    profile: "Customer",
    resourceId: "fixture-reverse-customer",
  }));
  assert.equal(received.ok, true);
  assert.equal(received.ownerSubjectId, CUSTOMER_2.id);

  const retailerRemoves = quiet(removeProfile(store, {
    actor: BOTH_AS_RETAILER,
    tenantId: "tenant-a-child",
    subjectId: CUSTOMER_2.id,
    profile: "Customer",
    changedAt: "2026-10-07T08:00:00Z",
  }));
  assert.equal(retailerRemoves.error, "capability grantor is not configured");
  assert.deepEqual(rolesOf(store, CUSTOMER_2.id), ["Customer"]);

  const secret = quiet(recordProfileResource(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    profile: "Retailer",
    resourceId: "bearer fixture-token",
    changedAt: "2026-10-07T08:00:00Z",
    credential: "fixture-credential",
  }));
  assert.equal(secret.error, "secret value is not allowed");
  const rate = quiet(assignProfile(store, {
    actor: DIST,
    tenantId: "tenant-a-child",
    role: "Retailer",
    subjectId: "fixture-rate-subject",
    changedAt: CHANGED,
    commission: "fixture-rate",
  }));
  assert.equal(rate.error, "unsupported field");
  assert.equal(JSON.stringify(store).includes("fixture-token"), false);
  assert.equal(JSON.stringify(store).includes("fixture-credential"), false);
  assert.equal(JSON.stringify(store).includes("fixture-rate"), false);
  assert.equal(JSON.stringify(store).includes("checklist.write"), false);
  assert.equal(store.profiles.some((row) => row.subjectId === "fixture-rate-subject"), false);

  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
  assert.throws(() => {
    health.liveTrading = "ON";
  });
  const source = readFileSync(new URL("../services/role-profiles.mjs", import.meta.url), "utf8");
  const delegationSource = readFileSync(new URL("../services/role-delegation.mjs", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../packages/contracts/src/roles.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("PERMISSION_MATRIX"), false);
  assert.equal(source.includes("Retailer+Customer"), false);
  assert.equal(delegationSource.includes("PERMISSION_MATRIX"), false);
  assert.equal(catalog.includes("NO_GRANTS"), true);
  assert.deepEqual(ROLE_NAMES, [
    "Super Admin",
    "Admin",
    "Super Distributor",
    "Distributor",
    "Retailer",
    "Customer",
  ]);
  for (const name of ROLE_NAMES) {
    assert.equal(PERMISSION_MATRIX[name].length, 0);
  }
  assert.deepEqual(Object.keys(delegationApi).sort(), [
    "DELEGATION_LIMITATIONS",
    "createDelegationStore",
    "delegateRole",
    "grantSeatCapability",
    "registerDelegationTenant",
  ]);
  assert.deepEqual(Object.keys(profileApi).sort(), [
    "PROFILE_LIMITATIONS",
    "assignProfile",
    "createProfileStore",
    "readProfileResource",
    "recordProfileResource",
    "removeProfile",
  ]);
  assert.equal(PROFILE_LIMITATIONS.includes("only Retailer and Customer may share one subject"), true);
  assert.equal(PROFILE_LIMITATIONS.includes("commission basis and caps are NOT IN SOURCE"), true);
  assert.equal(PROFILE_LIMITATIONS.includes("Retailer seat-creation grantor is NOT IN SOURCE"), true);
  assert.equal(authorizeShell(BOTH, "tenant-a-child").editChecklist, false);
});
