import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as search from "../services/search-documents.mjs";
import {
  createSearchIndex,
  indexSearchDocument,
  querySearchDocuments,
  readSearchDocuments,
  reviseSearchVisibility,
  SEARCH_DOCUMENT_KINDS,
  SEARCH_DOCUMENT_SCHEMA,
} from "../services/search-documents.mjs";

// Caller fixtures. Probability, model version, region, and checklist version are NOT IN SOURCE.
// Wrapped SOL decimals 9 and the mint are the documented Raydium CLI pair.
// Visibility uses the existing role names. The source names no other visibility vocabulary.
const VERSION = "fixture-1";
const TENANT = "tenant-a";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const ADMIN = { role: "Admin", tenantId: TENANT };
const CUSTOMER = { role: "Customer", tenantId: TENANT };

function withAccess(document, who = ADMIN) {
  return {
    actor: who,
    document: {
      version: VERSION,
      tenantId: TENANT,
      visibility: ["Admin", "Customer"],
      ...document,
    },
  };
}

function take(index, input) {
  const result = indexSearchDocument(index, input);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.blocked, null);
  return result.document;
}

function symbolDocument(visibility = ["Admin", "Customer"]) {
  return {
    kind: "symbol",
    version: VERSION,
    tenantId: TENANT,
    visibility,
    symbol: "BTC",
    venue: "Binance",
    base: "BTC",
    quote: "USDT",
    contractType: "Spot",
  };
}

test("representative versioned documents index", () => {
  const index = createSearchIndex();
  const symbol = take(index, withAccess({
    kind: "symbol",
    symbol: "BTC",
    venue: "Binance",
    base: "BTC",
    quote: "USDT",
    contractType: "Spot",
  }));
  const venue = take(index, withAccess({
    kind: "venue",
    venue: "Binance",
    venueKind: "CEX",
    product: "Spot",
    docsReference: "https://developers.binance.com/en/docs",
    region: "fixture",
  }));
  const token = take(index, withAccess({
    kind: "token",
    chain: "Solana",
    tokenAddress: WRAPPED_SOL_MINT,
    symbol: "SOL",
    decimals: 9,
  }));
  const prediction = take(index, withAccess({
    kind: "prediction",
    asset: "BTC",
    venue: "Binance",
    horizon: "1h",
    direction: "neutral",
    modelVersion: "fixture",
    probability: "fixture",
  }));
  const item = take(index, withAccess({
    kind: "checklist item",
    title: "Search documents",
    scope: "API",
    status: "NOT_STARTED",
    phaseId: "09.A",
    owner: null,
    enabled: true,
  }));
  const incident = take(index, withAccess({
    kind: "incident",
    fingerprint: "fixture-fingerprint",
    route: "health",
    release: null,
    firstSeen: "2026-10-06T00:00:00Z",
    lastSeen: "2026-10-06T00:00:00Z",
    seenCount: 1,
    suspectedCause: null,
    confidence: null,
    status: "FAIL",
    owner: null,
  }));
  const runbook = take(index, withAccess({
    kind: "runbook",
    title: "Rollback",
    summary: "Recovery drill for the release.",
  }));
  const stored = readSearchDocuments(index, { actor: ADMIN });
  const customerView = querySearchDocuments(index, { actor: CUSTOMER });
  assert.equal(stored.ok, true);
  assert.equal(stored.documents.length, 7);
  assert.equal(customerView.ok, true);
  assert.equal(customerView.documents.length, 7);
  assert.deepEqual(stored.documents.map((document) => document.kind), [...SEARCH_DOCUMENT_KINDS]);
  for (const document of stored.documents) {
    assert.equal(document.schema, SEARCH_DOCUMENT_SCHEMA);
    assert.equal(document.version, VERSION);
    assert.equal(document.tenantId, TENANT);
    assert.deepEqual(document.visibility, ["Admin", "Customer"]);
    assert.equal(Object.isFrozen(document), true);
    assert.equal(Object.isFrozen(document.visibility), true);
    assert.match(document.id, /^search-\d+$/);
  }
  assert.equal(symbol.symbol, "BTC");
  assert.equal(symbol.tenantId, TENANT);
  assert.equal(venue.venueKind, "CEX");
  assert.equal(token.decimals, 9);
  assert.equal(token.tokenAddress, WRAPPED_SOL_MINT);
  assert.equal(prediction.horizon, "1h");
  assert.equal(prediction.direction, "neutral");
  assert.equal(item.tenantId, TENANT);
  assert.equal(item.status, "NOT_STARTED");
  assert.equal(incident.confidence, null);
  assert.equal(runbook.title, "Rollback");
});

test("schema validation rejects sensitive, tick, unauthorized, and unsupported fields", () => {
  const index = createSearchIndex();
  const secret = indexSearchDocument(index, {
    document: {
      kind: "runbook",
      version: VERSION,
      title: "Rollback",
      summary: "Recovery drill for the release.",
      password: "hunter2",
    },
  });
  assert.equal(secret.ok, false);
  assert.equal(secret.blocked, "BLOCKED");
  assert.equal(secret.error, "sensitive field");
  assert.equal(Object.hasOwn(secret, "document"), false);

  const keyBlock = indexSearchDocument(index, {
    actor: CUSTOMER,
    document: {
      kind: "runbook",
      version: VERSION,
      tenantId: TENANT,
      visibility: ["Admin", "Customer"],
      title: "Rollback",
      summary: "BEGIN PRIVATE KEY",
    },
  });
  assert.equal(keyBlock.error, "sensitive field");
  assert.equal(Object.hasOwn(keyBlock, "document"), false);

  const book = indexSearchDocument(index, {
    document: {
      ...symbolDocument(),
      bids: [["1", "1"]],
      asks: [["2", "1"]],
    },
  });
  assert.equal(book.error, "raw order book");

  const ticks = indexSearchDocument(index, {
    document: {
      ...symbolDocument(),
      tickStream: ["1"],
    },
  });
  assert.equal(ticks.error, "raw order book");

  const otherTenant = indexSearchDocument(index, withAccess({
    kind: "checklist item",
    tenantId: "tenant-b",
    title: "Search documents",
    scope: "API",
    status: "NOT_STARTED",
    phaseId: "09.A",
    owner: null,
    enabled: true,
  }));
  assert.equal(otherTenant.ok, false);
  assert.equal(otherTenant.error, "role scope denied");
  assert.equal(Object.hasOwn(otherTenant, "document"), false);

  const missingActor = indexSearchDocument(index, {
    document: {
      kind: "incident",
      version: VERSION,
      tenantId: TENANT,
      visibility: ["Admin", "Customer"],
      fingerprint: "fixture-fingerprint",
      route: "health",
      release: null,
      firstSeen: "2026-10-06T00:00:00Z",
      lastSeen: "2026-10-06T00:00:00Z",
      seenCount: 1,
      suspectedCause: null,
      confidence: null,
      status: "FAIL",
      owner: null,
    },
  });
  assert.equal(missingActor.error, "role scope denied");

  const customerIndex = indexSearchDocument(index, withAccess(symbolDocument(), CUSTOMER));
  assert.equal(customerIndex.error, "role scope denied");

  const extra = indexSearchDocument(index, withAccess({
    kind: "symbol",
    symbol: "BTC",
    venue: "Binance",
    base: "BTC",
    quote: "USDT",
    contractType: "Spot",
    note: "extra",
  }));
  assert.equal(extra.error, "unsupported field");

  const passed = indexSearchDocument(index, withAccess({
    kind: "checklist item",
    title: "Search documents",
    scope: "API",
    status: "PASS",
    phaseId: "09.A",
    owner: null,
    enabled: true,
  }));
  assert.equal(passed.error, "unsupported field");

  const mobile = indexSearchDocument(index, withAccess({
    kind: "checklist item",
    title: "Search documents",
    scope: "mobile",
    status: "NOT_STARTED",
    phaseId: "09.A",
    owner: null,
    enabled: true,
  }));
  assert.equal(mobile.error, "unsupported field");

  const stored = readSearchDocuments(index, { actor: ADMIN });
  assert.equal(stored.documents.length, 0);
  const body = JSON.stringify(stored);
  assert.equal(body.includes("hunter2"), false);
  assert.equal(body.includes("tenant-b"), false);
  assert.equal(body.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(body.includes("bids"), false);
});

test("queries hide other tenants, other roles, and stale visibility", () => {
  const index = createSearchIndex();
  const visibility = ["Admin", "Customer"];
  const symbol = take(index, {
    actor: ADMIN,
    document: symbolDocument(visibility),
  });
  visibility.push("Retailer");
  const adminOnly = take(index, {
    actor: ADMIN,
    document: {
      kind: "runbook",
      version: VERSION,
      tenantId: TENANT,
      visibility: ["Admin"],
      title: "Rollback",
      summary: "Recovery drill for the release.",
    },
  });
  const distributorOnly = take(index, {
    actor: ADMIN,
    document: {
      kind: "venue",
      version: VERSION,
      tenantId: TENANT,
      visibility: ["Distributor"],
      venue: "Binance",
      venueKind: "CEX",
      product: "Spot",
      docsReference: "https://developers.binance.com/en/docs",
      region: "fixture",
    },
  });

  const adminView = querySearchDocuments(index, { actor: ADMIN });
  const customerView = querySearchDocuments(index, { actor: CUSTOMER });
  assert.deepEqual(adminView.documents.map((document) => document.id), [symbol.id, adminOnly.id]);
  assert.deepEqual(customerView.documents.map((document) => document.id), [symbol.id]);
  assert.deepEqual(customerView.documents[0].visibility, ["Admin", "Customer"]);
  assert.equal(JSON.stringify(customerView).includes(distributorOnly.id), false);

  for (const role of ["Super Admin", "Super Distributor", "Distributor", "Retailer"]) {
    const hidden = querySearchDocuments(index, { actor: { role, tenantId: TENANT } });
    assert.equal(hidden.ok, true, role);
    assert.equal(hidden.blocked, null);
    assert.deepEqual(hidden.documents, []);
  }
  for (const role of ["Admin", "Customer"]) {
    const cross = querySearchDocuments(index, { actor: { role, tenantId: "tenant-b" } });
    assert.equal(cross.ok, true, role);
    assert.deepEqual(cross.documents, []);
    assert.equal(JSON.stringify(cross).includes("BTC"), false);
  }

  const unknown = querySearchDocuments(index, { actor: { role: "Auditor", tenantId: TENANT } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, "role scope denied");
  assert.equal(Object.hasOwn(unknown, "documents"), false);

  const widened = querySearchDocuments(index, { actor: CUSTOMER, granted: true });
  assert.equal(widened.ok, false);
  assert.equal(widened.error, "role scope denied");
  assert.equal(Object.hasOwn(widened, "documents"), false);
  assert.equal(JSON.stringify(widened).includes("BTC"), false);

  const unauthenticated = readSearchDocuments(index);
  assert.equal(unauthenticated.error, "role scope denied");
  assert.equal(Object.hasOwn(unauthenticated, "documents"), false);

  const crossIndex = indexSearchDocument(index, withAccess(symbolDocument(), { role: "Admin", tenantId: "tenant-b" }));
  assert.equal(crossIndex.error, "role scope denied");
  const flagged = indexSearchDocument(index, { ...withAccess(symbolDocument()), granted: true });
  assert.equal(flagged.error, "role scope denied");

  const customerRevise = reviseSearchVisibility(index, {
    actor: CUSTOMER,
    documentId: symbol.id,
    visibility: ["Customer"],
  });
  assert.equal(customerRevise.ok, false);
  assert.equal(customerRevise.error, "role scope denied");
  assert.equal(Object.hasOwn(customerRevise, "document"), false);
  assert.equal(querySearchDocuments(index, { actor: CUSTOMER }).documents.length, 1);

  const wrongTenant = reviseSearchVisibility(index, {
    actor: { role: "Admin", tenantId: "tenant-b" },
    documentId: symbol.id,
    visibility: ["Admin"],
  });
  assert.equal(wrongTenant.error, "role scope denied");

  const missingId = reviseSearchVisibility(index, {
    actor: ADMIN,
    documentId: "search-missing",
    visibility: ["Admin"],
  });
  assert.equal(missingId.error, "role scope denied");

  const badVisibility = reviseSearchVisibility(index, {
    actor: ADMIN,
    documentId: symbol.id,
    visibility: ["public"],
  });
  assert.equal(badVisibility.error, "unsupported field");
  assert.equal(index.visibilityById[symbol.id].length, 1);

  const narrowed = reviseSearchVisibility(index, {
    actor: ADMIN,
    documentId: symbol.id,
    visibility: ["Admin"],
  });
  assert.equal(narrowed.ok, true);
  assert.deepEqual(narrowed.document.visibility, ["Admin"]);
  assert.deepEqual(index.documents.find((document) => document.id === symbol.id).visibility, ["Admin", "Customer"]);
  assert.equal(index.visibilityById[symbol.id].length, 2);
  assert.deepEqual(index.visibilityById[symbol.id][1], ["Admin"]);

  const customerAfter = querySearchDocuments(index, { actor: CUSTOMER });
  const adminAfter = querySearchDocuments(index, { actor: ADMIN });
  assert.deepEqual(customerAfter.documents, []);
  assert.equal(JSON.stringify(customerAfter).includes("BTC"), false);
  assert.deepEqual(adminAfter.documents.map((document) => document.id), [symbol.id, adminOnly.id]);
  assert.deepEqual(adminAfter.documents[0].visibility, ["Admin"]);

  const customerAgain = querySearchDocuments(index, { actor: CUSTOMER });
  assert.deepEqual(customerAgain.documents, []);
  const opened = reviseSearchVisibility(index, {
    actor: ADMIN,
    documentId: distributorOnly.id,
    visibility: ["Admin", "Customer"],
  });
  assert.equal(opened.ok, true);
  const distributorStill = querySearchDocuments(index, { actor: { role: "Distributor", tenantId: TENANT } });
  assert.deepEqual(distributorStill.documents, []);
  const customerOpened = querySearchDocuments(index, { actor: CUSTOMER });
  assert.deepEqual(customerOpened.documents.map((document) => document.id), [distributorOnly.id]);
  assert.deepEqual(customerOpened.documents[0].visibility, ["Admin", "Customer"]);
});

test("paper mode stays locked and the module does not export an order", () => {
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(search, name), false);
  }
});
