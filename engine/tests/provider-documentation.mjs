import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import {
  createProvider,
  createProviderRegistry,
  displayProviderDocumentation,
  recordProviderDocumentation,
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
  };
}

function reviewInput(lineageId, extra) {
  return {
    actor: admin,
    lineageId,
    changedAt: "2026-10-06T04:00:00Z",
    enabled: true,
    documentationUrl: "https://example.test/official-docs",
    checkedAt: "2026-10-06T03:00:00Z",
    supportedProducts: ["spot"],
    verificationOwner: "ada",
    stale: false,
    password: secret,
    ...extra,
  };
}

test("an enabled provider keeps a documentation review and stale is not verified", () => {
  const store = createProviderRegistry();
  const created = createProvider(store, providerInput("CEX"));
  const other = createProvider(store, providerInput("DEX"));
  assert.equal(displayProviderDocumentation(store, created.record.lineageId), "review unverified");

  const missing = recordProviderDocumentation(store, reviewInput(created.record.lineageId, {
    checkedAt: null,
  }));
  assert.equal(missing.error, "checked-at is required");
  assert.equal(store.documentation.length, 0);
  assert.equal(store.audits.filter((audit) => audit.action === "documentation-review").length, 0);

  const secretUrl = recordProviderDocumentation(store, reviewInput(created.record.lineageId, {
    documentationUrl: `https://user:${secret}@example.test/docs`,
  }));
  assert.equal(secretUrl.error, "documentation url is not allowed");
  assert.equal(JSON.stringify(secretUrl).includes(secret), false);

  const recorded = recordProviderDocumentation(store, reviewInput(created.record.lineageId));
  assert.equal(recorded.ok, true);
  assert.equal(recorded.review, "verified");
  assert.equal(recorded.row.documentationUrl, "https://example.test/official-docs");
  assert.equal(recorded.row.checkedAt, "2026-10-06T03:00:00Z");
  assert.deepEqual(recorded.row.supportedProducts, ["spot"]);
  assert.equal(recorded.row.verificationOwner, "ada");
  const verifiedDisplay = displayProviderDocumentation(store, created.record.lineageId);
  assert.equal(verifiedDisplay.includes("review verified"), true);
  assert.equal(verifiedDisplay.includes(secret), false);

  const stale = recordProviderDocumentation(store, reviewInput(created.record.lineageId, {
    stale: true,
    changedAt: "2026-10-06T05:00:00Z",
  }));
  assert.equal(stale.review, "stale");
  const staleDisplay = displayProviderDocumentation(store, created.record.lineageId);
  assert.equal(staleDisplay.includes("review stale"), true);
  assert.equal(staleDisplay.includes("review verified"), false);
  assert.equal(staleDisplay.includes("checked-at 2026-10-06T03:00:00Z"), true);
  assert.equal(staleDisplay.includes("owner ada"), true);
  assert.equal(staleDisplay.includes("products spot"), true);

  const disabled = recordProviderDocumentation(store, reviewInput(other.record.lineageId, {
    enabled: false,
    documentationUrl: null,
    checkedAt: null,
    supportedProducts: null,
    verificationOwner: null,
  }));
  assert.equal(disabled.review, "unverified");
  assert.equal(displayProviderDocumentation(store, other.record.lineageId).includes("review verified"), false);

  const denied = recordProviderDocumentation(store, reviewInput(created.record.lineageId, {
    actor: { id: "customer-1", role: "Customer", tenantId: "tenant-1" },
  }));
  assert.equal(denied.error, "role scope denied");
  assert.equal(JSON.stringify(store.documentation).includes(secret), false);
  assert.equal(JSON.stringify(store.audits).includes(secret), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
