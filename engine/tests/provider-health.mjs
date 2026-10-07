import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createProvider,
  createProviderRegistry,
  displayProviderHealth,
  recordProviderHealth,
} from "../services/provider-registry.mjs";

const admin = { id: "admin-1", role: "Admin", tenantId: "tenant-1" };
const secret = "super-secret-value";
// The source names no retry budget, safety margin, or heartbeat age.
const documentedLimit = 10;
const safetyMargin = 3;
const retryBudget = 2;

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
    marketData: { vaultReference: "vault-ref-market-data", permissionScope: "read-only" },
  };
}

function observation(lineageId, extra) {
  return {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T01:00:00Z",
    documentedLimit,
    safetyMargin,
    observed: 4,
    retryBudget,
    requestedRetries: 50,
    heartbeatAge: 5,
    headers: {
      "retry-after": "caller-retry-after",
      authorization: secret,
    },
    password: secret,
    ...extra,
  };
}

test("a 429 and a disconnect stay degraded inside the caller budget", () => {
  const store = createProviderRegistry();
  const created = createProvider(store, providerInput("CEX"));
  const other = createProvider(store, providerInput("DEX"));
  const lineageId = created.record.lineageId;

  const limited = recordProviderHealth(store, observation(lineageId, { httpStatus: 429 }));
  assert.equal(limited.ok, true);
  assert.equal(limited.status, "degraded");
  assert.equal(limited.attempts, retryBudget);
  assert.equal(limited.backoffState, "bounded");
  assert.equal(limited.heartbeatAge, "5");
  assert.deepEqual(limited.headers, { "retry-after": "caller-retry-after" });
  assert.equal(JSON.stringify(limited).includes(secret), false);
  assert.equal(created.record.status, "caller-status");
  assert.equal(store.actions.length, 0);

  const again = recordProviderHealth(store, observation(lineageId, {
    httpStatus: 429,
    changedAt: "2026-10-06T01:01:00Z",
  }));
  assert.equal(again.attempts, retryBudget);
  assert.equal(store.health.filter((entry) => entry.lineageId === lineageId).length, 2);

  const margin = recordProviderHealth(store, observation(lineageId, {
    httpStatus: 429,
    observed: 8,
    changedAt: "2026-10-06T01:02:00Z",
  }));
  assert.equal(margin.status, "degraded");
  assert.equal(margin.attempts, 0);
  assert.equal(margin.backoffState, "stopped");

  const unconfigured = recordProviderHealth(store, observation(lineageId, {
    httpStatus: 429,
    safetyMargin: null,
    changedAt: "2026-10-06T01:03:00Z",
  }));
  assert.equal(unconfigured.attempts, 0);
  assert.equal(unconfigured.backoffState, "stopped");
  assert.equal(unconfigured.retryBudget, retryBudget);

  const disconnected = recordProviderHealth(store, observation(other.record.lineageId, {
    connectionStatus: "disconnected",
    changedAt: "2026-10-06T01:04:00Z",
  }));
  assert.equal(disconnected.status, "degraded");
  assert.equal(disconnected.connectionStatus, "disconnected");
  assert.equal(disconnected.attempts, retryBudget);
  assert.equal(disconnected.backoffState, "bounded");

  const ui = displayProviderHealth(store, lineageId);
  assert.equal(ui.includes("status degraded"), true);
  assert.equal(ui.includes("backoff stopped"), true);
  assert.equal(ui.includes("heartbeat-age 5"), true);
  assert.equal(ui.includes("retry-after=caller-retry-after"), true);
  assert.equal(ui.includes(secret), false);
  const otherUi = displayProviderHealth(store, other.record.lineageId);
  assert.equal(otherUi.includes("connection disconnected"), true);
  assert.equal(otherUi.includes("status degraded"), true);
  assert.equal(JSON.stringify(store.health).includes(secret), false);
  assert.equal(JSON.stringify(store.audits).includes(secret), false);

  const denied = recordProviderHealth(store, observation(lineageId, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
  }));
  assert.equal(denied.error, "role scope denied");
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
