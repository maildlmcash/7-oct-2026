import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createProvider,
  createProviderRegistry,
  displayProviderActions,
  fetchOnce,
  importProvider,
  startAuto,
  testConnection,
} from "../services/provider-registry.mjs";

const admin = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const secret = "super-secret-value";
const marketReference = "vault-ref-market-data";
const orderReference = "vault-ref-orders";

function providerInput(extra) {
  return {
    actor: admin,
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
    autoStart: true,
    password: secret,
    marketData: { vaultReference: marketReference, permissionScope: "read-only" },
    orders: { vaultReference: orderReference, permissionScope: "order-capable" },
    ...extra,
  };
}

test("test, fetch, and auto start stay distinct and auto stays off after create and import", () => {
  const store = createProviderRegistry();
  const created = createProvider(store, providerInput());
  assert.equal(created.ok, true);
  assert.equal(created.record.autoStart, false);
  assert.equal(store.actions.length, 0);
  assert.equal(displayProviderActions(store, created.record.lineageId).includes("auto off"), true);

  const imported = importProvider(store, providerInput({ kind: "WebSocket", version: "1" }));
  assert.equal(imported.ok, true);
  assert.equal(imported.record.autoStart, false);
  assert.equal(store.audits.filter((audit) => audit.lineageId === imported.record.lineageId).map((audit) => audit.action).join(","), "import");
  assert.equal(store.actions.length, 0);

  const lineageId = created.record.lineageId;
  const tested = testConnection(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T01:00:00Z",
    password: secret,
  });
  assert.equal(tested.ok, true);
  assert.equal(tested.action, "test-connection");
  assert.equal(tested.connected, false);
  assert.equal(tested.fetched, false);
  assert.equal(tested.autoStart, false);
  assert.equal(created.record.autoStart, false);

  const fetched = fetchOnce(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(fetched.action, "fetch-once");
  assert.equal(fetched.connected, false);
  assert.equal(fetched.fetched, false);
  assert.equal(fetched.autoStart, false);
  assert.notEqual(tested.action, fetched.action);

  const unconfirmed = startAuto(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T03:00:00Z",
    confirmation: secret,
  });
  assert.equal(unconfirmed.error, "confirmation is required");
  assert.equal(unconfirmed.autoStart, false);
  assert.equal(JSON.stringify(unconfirmed).includes(secret), false);
  assert.equal(store.actions.some((entry) => entry.action === "auto-start"), false);

  const ordersOnly = createProvider(store, providerInput({
    kind: "DEX",
    marketData: null,
    orders: { vaultReference: orderReference, permissionScope: "order-capable" },
  }));
  const orderStart = startAuto(store, {
    actor: admin,
    lineageId: ordersOnly.record.lineageId,
    changedAt: "2026-10-06T03:00:00Z",
    confirmation: true,
  });
  assert.equal(orderStart.error, "read-only scope is required");
  assert.equal(orderStart.autoStart, false);

  const customer = startAuto(store, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
    lineageId,
    changedAt: "2026-10-06T03:00:00Z",
    confirmation: true,
  });
  assert.equal(customer.error, "role scope denied");
  assert.equal(store.actions.filter((entry) => entry.lineageId === lineageId).length, 2);

  const started = startAuto(store, {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T04:00:00Z",
    confirmation: true,
    password: secret,
  });
  assert.equal(started.ok, true);
  assert.equal(started.action, "auto-start");
  assert.equal(started.permissionScope, "read-only");
  assert.equal(started.autoStart, true);
  assert.equal(started.connected, false);
  assert.equal(started.fetched, false);
  assert.equal(created.record.autoStart, false);

  const ui = displayProviderActions(store, lineageId);
  assert.equal(ui.includes("Test Connection"), true);
  assert.equal(ui.includes("Fetch Once"), true);
  assert.equal(ui.includes("Auto Start"), true);
  assert.equal(ui.includes("test-connection 1"), true);
  assert.equal(ui.includes("fetch-once 1"), true);
  assert.equal(ui.includes("auto-start 1"), true);
  assert.equal(ui.includes("auto on"), true);
  assert.equal(ui.includes(secret), false);
  assert.equal(JSON.stringify(store.actions).includes(secret), false);
  assert.equal(JSON.stringify(store.audits).includes(secret), false);
  assert.equal(displayProviderActions(store, imported.record.lineageId).includes("auto off"), true);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
