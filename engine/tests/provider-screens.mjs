import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  CAPABILITY_LABELS,
  CONNECTION_STATUSES,
  DETAIL_TABS,
  PROVIDER_LISTS,
  connectionStatus,
  editProviderMetadata,
  filterProviders,
  registrySchema,
  screenRegistry,
  sortProviders,
} from "../packages/contracts/src/providers/index.mjs";

const evidenceDir = resolve(import.meta.dirname, "../docs/architecture/evidence/1-c-1");
const SECRET = "super-secret-value";

test("provider screens keep connection status honest and limit metadata edits", async () => {
  const rows = screenRegistry();
  assert.deepEqual(rows.map((record) => record.list), [
    "CEX",
    "CEX",
    "DEX",
    "data vendor",
    "wallet-monitoring",
  ]);
  assert.deepEqual([...PROVIDER_LISTS], ["CEX", "DEX", "data vendor", "wallet-monitoring"]);
  assert.deepEqual([...CONNECTION_STATUSES], ["NOT_CONFIGURED", "NOT_TESTED"]);
  assert.deepEqual([...DETAIL_TABS], ["REST", "WebSocket", "chain/RPC", "fields", "calculations", "permissions"]);
  assert.deepEqual([...CAPABILITY_LABELS], ["public-read-only", "account-read", "trade"]);

  const named = rows.find((record) => record.id === "cex-binance-spot");
  assert.equal(connectionStatus(named), "NOT_TESTED");
  assert.equal(named.lastVerified, null);
  assert.equal(named.capabilities["public-read-only"], "declared");
  assert.equal(named.capabilities["account-read"], "unavailable");
  assert.equal(named.capabilities.trade, "unavailable");
  for (const record of rows.filter((item) => item.id !== "cex-binance-spot")) {
    assert.equal(connectionStatus(record), "NOT_CONFIGURED");
    assert.equal(record.lastVerified, null);
    assert.equal(record.sourceUrl, null);
  }
  const wallet = rows.find((record) => record.list === "wallet-monitoring");
  assert.equal(JSON.stringify(wallet).includes("0x"), false);
  assert.equal(JSON.stringify(wallet).includes("balance"), false);

  const cex = rows.filter((record) => record.list === "CEX");
  assert.deepEqual(sortProviders(cex, "status").map((record) => connectionStatus(record)), ["NOT_CONFIGURED", "NOT_TESTED"]);
  assert.deepEqual(filterProviders(rows, "binance").map((record) => record.id), ["cex-binance-spot"]);
  assert.deepEqual(filterProviders(rows, "NOT_CONFIGURED").map((record) => record.list).sort(), [
    "CEX",
    "DEX",
    "data vendor",
    "wallet-monitoring",
  ]);

  const customer = editProviderMetadata(named, { product: "Renamed" }, { role: "Customer", tenantId: named.tenantId });
  assert.equal(customer.ok, false);
  assert.equal(customer.error, "role scope denied");
  const statusEdit = editProviderMetadata(named, { status: "LIVE" }, { role: "Admin", tenantId: named.tenantId });
  assert.equal(statusEdit.ok, false);
  assert.equal(statusEdit.error, "field is not editable");
  const secret = editProviderMetadata(named, { sourceUrl: `https://user:${SECRET}@data-api.binance.vision/` }, { role: "Admin", tenantId: named.tenantId });
  assert.equal(secret.ok, false);
  assert.equal(secret.error, "secret value is not allowed");
  const edited = editProviderMetadata(named, {
    product: "Binance Spot public",
    version: "v3",
    sourceUrl: "https://data-api.binance.vision/api",
  }, { role: "Admin", tenantId: named.tenantId });
  assert.equal(edited.ok, true);
  assert.equal(edited.status, "NOT_TESTED");
  assert.equal(edited.record.lastVerified, null);
  assert.equal(edited.record.capabilities.trade, "unavailable");
  const cleared = editProviderMetadata(edited.record, { sourceUrl: "" }, { role: "Admin", tenantId: named.tenantId });
  assert.equal(cleared.status, "NOT_CONFIGURED");
  assert.equal(cleared.record.lastVerified, null);

  const schema = registrySchema();
  assert.equal(schema.lastVerified, null);
  assert.equal(schema.orders, false);
  assert.equal(schema.walletAccess, false);
  const snapshot = {
    task: "1.C.1",
    date: "2026-10-07",
    truth: "MOCK",
    schema,
    rows: rows.map((record) => ({
      id: record.id,
      list: record.list,
      product: record.product,
      version: record.version,
      sourceUrl: record.sourceUrl,
      status: connectionStatus(record),
      lastVerified: record.lastVerified,
      capabilities: record.capabilities,
      tabs: DETAIL_TABS,
    })),
  };
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
  assert.equal(JSON.stringify(snapshot).includes("LIVE"), false);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "registry-schema.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
});
