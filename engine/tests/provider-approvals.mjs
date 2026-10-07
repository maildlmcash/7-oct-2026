import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  approveProviderChange,
  createProvider,
  createProviderRegistry,
  displayProviderReview,
  readLastKnownGood,
  rollbackProvider,
  updateProvider,
} from "../services/provider-registry.mjs";

const maker = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const reviewer = { id: "admin-2", role: "Admin", tenantId: "tenant-1" };
const secret = "super-secret-value";

function providerInput() {
  return {
    actor: maker,
    tenantId: "tenant-1",
    kind: "CEX",
    product: "spot",
    channel: "trades",
    docsReference: "https://example.test/docs",
    region: "caller-region",
    limits: "caller limit text",
    heartbeat: "caller heartbeat text",
    status: "caller-status",
    version: "1",
    changedAt: "2026-10-06T00:00:00Z",
    marketData: { vaultReference: "vault-ref-market-data", permissionScope: "read-only" },
  };
}

test("approval and rollback restore the selected version and keep the audit trail", () => {
  const store = createProviderRegistry();
  const created = createProvider(store, providerInput());
  const lineageId = created.record.lineageId;
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.version, "1");

  const channel = updateProvider(store, {
    actor: maker,
    lineageId,
    version: "2",
    channel: "book",
    changedAt: "2026-10-06T01:00:00Z",
    password: secret,
  });
  assert.equal(channel.record.knownGood, false);
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.channel, "trades");
  assert.equal(displayProviderReview(store, lineageId).includes("last known good 1"), true);
  assert.equal(displayProviderReview(store, lineageId).includes("pending 2"), true);

  const self = approveProviderChange(store, {
    actor: maker,
    lineageId,
    versionId: channel.record.id,
    changedAt: "2026-10-06T01:30:00Z",
  });
  assert.equal(self.error, "maker cannot approve");
  assert.equal(store.audits.length, 2);

  const approved = approveProviderChange(store, {
    actor: reviewer,
    lineageId,
    versionId: channel.record.id,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(approved.ok, true);
  assert.equal(readLastKnownGood(store, { actor: reviewer, lineageId }).record.channel, "book");
  const firstAudit = store.audits[0];

  const endpoint = updateProvider(store, {
    actor: maker,
    lineageId,
    version: "3",
    docsReference: "https://example.test/other",
    changedAt: "2026-10-06T02:30:00Z",
  });
  assert.equal(endpoint.record.knownGood, false);
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.docsReference, "https://example.test/docs");

  const limits = updateProvider(store, {
    actor: maker,
    lineageId,
    version: "4",
    limits: "other limit text",
    changedAt: "2026-10-06T02:40:00Z",
  });
  assert.equal(limits.record.knownGood, false);
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.limits, "caller limit text");

  const scope = updateProvider(store, {
    actor: maker,
    lineageId,
    version: "5",
    marketData: { vaultReference: "vault-ref-market-data-2", permissionScope: "read-only" },
    changedAt: "2026-10-06T02:50:00Z",
  });
  assert.equal(scope.record.knownGood, false);

  const heartbeat = updateProvider(store, {
    actor: maker,
    lineageId,
    version: "6",
    heartbeat: "other heartbeat text",
    changedAt: "2026-10-06T02:55:00Z",
  });
  assert.equal(heartbeat.record.knownGood, true);
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.version, "6");
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.channel, "book");

  const restored = rollbackProvider(store, {
    actor: reviewer,
    lineageId,
    versionId: created.record.id,
    version: "7",
    changedAt: "2026-10-06T03:00:00Z",
    password: secret,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.record.version, "7");
  assert.equal(restored.record.channel, "trades");
  assert.equal(restored.record.docsReference, "https://example.test/docs");
  assert.equal(restored.record.limits, "caller limit text");
  assert.equal(restored.record.marketData.vaultReference, "vault-ref-market-data");
  assert.equal(readLastKnownGood(store, { actor: maker, lineageId }).record.id, restored.record.id);
  assert.equal(store.records.filter((record) => record.lineageId === lineageId && record.version === "1").length, 1);
  assert.equal(store.records.find((record) => record.version === "2").channel, "book");
  assert.equal(store.audits[0], firstAudit);
  assert.equal(firstAudit.action, "create");
  assert.throws(() => {
    firstAudit.action = "rollback";
  });
  const actions = store.audits.map((audit) => audit.action);
  assert.equal(actions.includes("approve"), true);
  assert.equal(actions.includes("rollback"), true);
  assert.equal(displayProviderReview(store, lineageId).includes("last known good 7"), true);
  assert.equal(displayProviderReview(store, lineageId).includes("channel trades"), true);
  assert.equal(JSON.stringify(store.audits).includes(secret), false);

  const pending = rollbackProvider(store, {
    actor: reviewer,
    lineageId,
    versionId: endpoint.record.id,
    version: "8",
    changedAt: "2026-10-06T03:30:00Z",
  });
  assert.equal(pending.error, "last known good is required");
  const customer = approveProviderChange(store, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
    lineageId,
    versionId: endpoint.record.id,
    changedAt: "2026-10-06T03:40:00Z",
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
