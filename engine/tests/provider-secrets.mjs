import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  authorizeProviderUse,
  createProvider,
  createProviderRegistry,
  providerExports,
  updateProvider,
} from "../services/provider-registry.mjs";

const admin = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const secret = "super-secret-value";
const privateKey = "-----BEGIN PRIVATE KEY-----\nabc";
const marketReference = "vault-ref-market-data";
const orderReference = "vault-ref-orders";

function baseInput(extra) {
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
    password: secret,
    ...extra,
  };
}

test("read-only market data stays separate from order credentials", () => {
  const store = createProviderRegistry();
  const traded = createProvider(store, baseInput({
    marketData: { vaultReference: marketReference, permissionScope: "order-capable" },
  }));
  assert.equal(traded.error, "read-only scope is required");
  assert.equal(store.audits.length, 0);
  assert.equal(JSON.stringify(traded).includes(secret), false);

  const shared = createProvider(store, baseInput({
    marketData: { vaultReference: marketReference, permissionScope: "read-only" },
    orders: { vaultReference: marketReference, permissionScope: "order-capable" },
  }));
  assert.equal(shared.error, "order credentials must be separate");
  assert.equal(store.audits.length, 0);

  const withdrawn = createProvider(store, baseInput({
    marketData: { vaultReference: marketReference, permissionScope: "read-only" },
    orders: { vaultReference: orderReference, permissionScope: "order-capable" },
    withdrawals: true,
  }));
  assert.equal(withdrawn.error, "withdrawals are closed");
  assert.equal(store.audits.length, 0);

  const created = createProvider(store, baseInput({
    marketData: {
      vaultReference: marketReference,
      permissionScope: "read-only",
      apiSecret: secret,
    },
    orders: { vaultReference: orderReference, permissionScope: "order-capable", token: secret },
  }));
  assert.equal(created.error, "credential field is not allowed");
  assert.equal(JSON.stringify(created).includes(secret), false);
  assert.equal(store.records.length, 0);

  const stored = createProvider(store, baseInput({
    marketData: { vaultReference: marketReference, permissionScope: "read-only" },
    orders: { vaultReference: orderReference, permissionScope: "order-capable" },
    apiSecret: secret,
    token: secret,
  }));
  assert.equal(stored.ok, true);
  assert.equal(stored.record.marketData.permissionScope, "read-only");
  assert.equal(stored.record.orders.permissionScope, "order-capable");
  assert.equal(stored.record.marketData.vaultReference, marketReference);
  assert.equal(stored.record.orders.vaultReference, orderReference);
  assert.equal(stored.record.withdrawals, false);
  assert.equal(JSON.stringify(stored.record).includes(secret), false);

  const market = authorizeProviderUse(stored.record, "market-data");
  assert.equal(market.ok, true);
  assert.equal(market.permissionScope, "read-only");
  assert.equal(market.vaultReference, marketReference);
  const ordersOnly = createProvider(store, baseInput({
    kind: "market-data API",
    version: "1",
    marketData: { vaultReference: marketReference, permissionScope: "read-only" },
  }));
  assert.equal(authorizeProviderUse(ordersOnly.record, "orders").error, "read-only scope cannot place orders");
  assert.equal(authorizeProviderUse(stored.record, "orders").permissionScope, "order-capable");
  assert.equal(authorizeProviderUse(stored.record, "orders").vaultReference, orderReference);
  assert.equal(authorizeProviderUse(stored.record, "withdrawals").error, "withdrawals are closed");

  const revealed = updateProvider(store, {
    actor: admin,
    lineageId: stored.record.lineageId,
    version: "2",
    changedAt: "2026-10-06T01:00:00Z",
    password: secret,
    apiSecret: secret,
    marketData: { vaultReference: secret, permissionScope: "read-only" },
  });
  assert.equal(revealed.error, "vault reference is not allowed");
  assert.equal(JSON.stringify(revealed).includes(secret), false);
  assert.equal(store.audits.filter((audit) => audit.lineageId === stored.record.lineageId).length, 1);

  const keyMaterial = createProvider(store, baseInput({
    kind: "DEX",
    marketData: { vaultReference: privateKey, permissionScope: "read-only" },
  }));
  assert.equal(keyMaterial.error, "vault reference is not allowed");
  assert.equal(JSON.stringify(store).includes("BEGIN PRIVATE KEY"), false);

  const exports = providerExports(store, { actor: admin, lineageId: stored.record.lineageId });
  assert.equal(exports.ok, true);
  for (const surface of [exports.serialization, exports.ui, exports.log, exports.audit]) {
    assert.equal(surface.includes(secret), false);
    assert.equal(surface.includes(marketReference), true);
    assert.equal(surface.includes("read-only"), true);
  }
  assert.equal(exports.ui.includes("withdrawals closed"), true);
  assert.equal(exports.ui.includes(orderReference), true);
  assert.equal(exports.audit.includes("order-capable"), true);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
