import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  PROVIDER_KINDS,
  archiveProvider,
  createProvider,
  createProviderRegistry,
  readProviderVersions,
  updateProvider,
} from "../services/provider-registry.mjs";

const admin = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const secret = "super-secret-value";

function providerInput(kind) {
  return {
    actor: admin,
    tenantId: "tenant-1",
    kind,
    product: "spot",
    channel: "trades",
    docsReference: "https://example.test/docs",
    region: "caller-region",
    limits: "caller limit text",
    heartbeat: "caller heartbeat text",
    status: "caller-status",
    version: "1",
    changedAt: "2026-10-06T00:00:00Z",
    password: secret,
  };
}

test("roles other than Admin are denied and write no audit", () => {
  const store = createProviderRegistry();
  const roles = [
    "Super Admin",
    "Super Distributor",
    "Distributor",
    "Retailer",
    "Customer",
  ];
  for (const role of roles) {
    const result = createProvider(store, {
      ...providerInput("CEX"),
      actor: { id: role, role, tenantId: "tenant-1" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "role scope denied");
  }
  const crossTenant = createProvider(store, {
    ...providerInput("CEX"),
    actor: { id: "admin-2", role: "Admin", tenantId: "tenant-2" },
  });
  assert.equal(crossTenant.error, "role scope denied");
  assert.equal(store.records.length, 0);
  assert.equal(store.audits.length, 0);
});

test("create, update, archive, and version keep history and audit every mutation", () => {
  const store = createProviderRegistry();
  assert.equal(createProvider(store, { ...providerInput("venue") }).error, "unknown provider kind");
  assert.equal(store.audits.length, 0);

  const created = [];
  for (const kind of PROVIDER_KINDS) {
    const result = createProvider(store, providerInput(kind));
    assert.equal(result.ok, true);
    assert.equal(result.record.kind, kind);
    assert.equal(result.record.lastError, null);
    created.push(result.record);
  }
  assert.equal(store.audits.length, PROVIDER_KINDS.length);
  assert.equal(store.audits[0].action, "create");
  assert.equal(store.audits[0].configChecksum, null);
  assert.equal(store.audits[0].approval, null);
  assert.equal(JSON.stringify(store.records).includes(secret), false);
  assert.equal(JSON.stringify(store.audits).includes(secret), false);

  const lineageId = created[0].lineageId;
  const updated = updateProvider(store, {
    actor: admin,
    lineageId,
    version: "2",
    channel: "book",
    lastError: "caller last error",
    changedAt: "2026-10-06T01:00:00Z",
    password: secret,
    approval: "not-this-task",
    configChecksum: "not-a-checksum",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.record.version, "2");
  assert.equal(updated.record.channel, "book");
  assert.equal(updated.record.product, "spot");
  assert.equal(updated.record.lastError, "caller last error");
  assert.equal(store.records.filter((record) => record.lineageId === lineageId).length, 2);
  assert.equal(store.records[0].version, "1");
  assert.equal(store.records[0].channel, "trades");

  const versions = readProviderVersions(store, { actor: admin, lineageId });
  assert.equal(versions.ok, true);
  assert.deepEqual(versions.versions.map((record) => record.version), ["1", "2"]);
  assert.equal(versions.audits.at(-1).action, "update");
  assert.equal(versions.audits.at(-1).approval, null);
  assert.equal(versions.audits.at(-1).configChecksum, null);
  const firstAudit = store.audits[0];

  const archived = archiveProvider(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(archived.ok, true);
  assert.equal(archived.versions.every((record) => record.archivedAt === "2026-10-06T02:00:00Z"), true);
  assert.equal(store.records.filter((record) => record.lineageId === lineageId).length, 2);
  const afterArchive = updateProvider(store, {
    actor: admin,
    lineageId,
    version: "3",
    changedAt: "2026-10-06T03:00:00Z",
  });
  assert.equal(afterArchive.error, "provider is archived");
  const actions = store.audits
    .filter((audit) => audit.lineageId === lineageId)
    .map((audit) => audit.action);
  assert.deepEqual(actions, ["create", "update", "archive"]);
  assert.equal(store.audits[0], firstAudit);
  assert.throws(() => {
    firstAudit.action = "archive";
  });
  const customer = readProviderVersions(store, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
    lineageId,
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});

test("limits and heartbeat stay caller text", () => {
  const store = createProviderRegistry();
  const numeric = createProvider(store, { ...providerInput("DEX"), limits: 15 });
  assert.equal(numeric.error, "limits must be text");
  assert.equal(store.audits.length, 0);
  const created = createProvider(store, providerInput("DEX"));
  assert.equal(created.record.limits, "caller limit text");
  assert.equal(created.record.heartbeat, "caller heartbeat text");
  const interval = updateProvider(store, {
    actor: admin,
    lineageId: created.record.lineageId,
    version: "2",
    heartbeat: 30,
    changedAt: "2026-10-06T01:00:00Z",
  });
  assert.equal(interval.error, "heartbeat must be text");
  assert.equal(store.records.length, 1);
  assert.equal(store.audits.length, 1);
});
