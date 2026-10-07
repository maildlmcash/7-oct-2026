// Versioned search documents for symbols, venues, tokens, predictions,
// checklist items, incidents, and runbooks.
// Design section 18 names OpenSearch and says not to put every tick or order book in the index.
// This module does not open a cluster. It validates and stores frozen documents in memory.
// Design page 15 forbids password, OTP, API secret, private key, seed phrase, and access token.
// Every document carries tenantId and visibility. Visibility values are the existing role names.
// The source names no other visibility vocabulary.
// Indexing and a visibility revision use canEditChecklist: same-tenant Admin only.
// A query uses canReadChecklistStatus and the latest visibility revision.
// A later revision is what a query sees. This module does not place orders.

import { canEditChecklist, canReadChecklistStatus } from "./checklist-status-view.mjs";
import { isKnownRole } from "../packages/contracts/src/roles.mjs";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SYMBOL = /^[A-Z0-9]+$/;
const STATUSES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT_APPLICABLE",
]);
const VENUE_KINDS = Object.freeze(["CEX", "DEX", "chain", "market-data API", "WebSocket"]);
const INDEX_INPUT_KEYS = Object.freeze(["actor", "document"]);
const QUERY_INPUT_KEYS = Object.freeze(["actor"]);
const REVISE_INPUT_KEYS = Object.freeze(["actor", "documentId", "visibility"]);
const ACTOR_KEYS = Object.freeze(["role", "tenantId"]);
const OPTIONAL_KEYS = new Set([
  "passApprover",
  "passExpiry",
  "notApplicableReason",
  "notApplicableApprover",
]);
const SENSITIVE_KEYS = new Set([
  "password",
  "otp",
  "apisecret",
  "privatekey",
  "seedphrase",
  "accesstoken",
  "credential",
  "credentials",
  "secret",
  "apikey",
  "authorization",
  "bearer",
  "cookie",
]);
const BOOK_KEYS = new Set([
  "bids",
  "asks",
  "ticks",
  "tickstream",
  "orderbook",
  "rawticks",
  "bookticks",
  "depthticks",
]);

export const SEARCH_DOCUMENT_SCHEMA = "search-document";
export const SEARCH_DOCUMENT_KINDS = Object.freeze([
  "symbol",
  "venue",
  "token",
  "prediction",
  "checklist item",
  "incident",
  "runbook",
]);

const KIND_KEYS = Object.freeze({
  symbol: Object.freeze(["kind", "version", "tenantId", "visibility", "symbol", "venue", "base", "quote", "contractType"]),
  venue: Object.freeze(["kind", "version", "tenantId", "visibility", "venue", "venueKind", "product", "docsReference", "region"]),
  token: Object.freeze(["kind", "version", "tenantId", "visibility", "chain", "tokenAddress", "symbol", "decimals"]),
  prediction: Object.freeze([
    "kind",
    "version",
    "tenantId",
    "visibility",
    "asset",
    "venue",
    "horizon",
    "direction",
    "modelVersion",
    "probability",
  ]),
  "checklist item": Object.freeze([
    "kind",
    "version",
    "tenantId",
    "visibility",
    "title",
    "scope",
    "status",
    "phaseId",
    "owner",
    "enabled",
    "passApprover",
    "passExpiry",
    "notApplicableReason",
    "notApplicableApprover",
  ]),
  incident: Object.freeze([
    "kind",
    "version",
    "tenantId",
    "visibility",
    "fingerprint",
    "route",
    "release",
    "firstSeen",
    "lastSeen",
    "seenCount",
    "suspectedCause",
    "confidence",
    "status",
    "owner",
  ]),
  runbook: Object.freeze(["kind", "version", "tenantId", "visibility", "title", "summary"]),
});

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
}

function denied() {
  return fail("role scope denied");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function optionalText(value) {
  return value === null || text(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function parseUtc(value) {
  if (typeof value !== "string" || !UTC.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sensitiveValue(value) {
  return typeof value === "string" && (
    value.includes("BEGIN PRIVATE KEY")
    || /seed phrase/i.test(value)
    || /bearer\s+/i.test(value)
  );
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    visit(key, item);
    walk(item, visit);
  }
}

function rejection(document) {
  let sensitive = false;
  let book = false;
  walk(document, (key, value) => {
    const name = normalizeKey(key);
    if (SENSITIVE_KEYS.has(name)) sensitive = true;
    if (BOOK_KEYS.has(name)) book = true;
    if (sensitiveValue(value)) sensitive = true;
  });
  if (sensitive) return "sensitive field";
  if (book) return "raw order book";
  return null;
}

function requireKeys(document, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(document, key)) return false;
  }
  return true;
}

function copyVisibility(list) {
  return Object.freeze([...list]);
}

function visibilityList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set();
  const copy = [];
  for (const role of value) {
    if (typeof role !== "string" || !isKnownRole(role) || seen.has(role)) return null;
    seen.add(role);
    copy.push(role);
  }
  return copy;
}

function actorOf(input) {
  if (!plainObject(input.actor) || unknownKey(input.actor, ACTOR_KEYS)) return null;
  const { role, tenantId } = input.actor;
  if (!isKnownRole(role) || !text(tenantId)) return null;
  return { role, tenantId };
}

function checklistStatus(document) {
  if (!STATUSES.includes(document.status) || typeof document.enabled !== "boolean") return false;
  if (document.scope === "mobile") return false;
  if (!text(document.title) || !text(document.scope) || !text(document.phaseId)) return false;
  if (!optionalText(document.owner)) return false;
  if (document.status === "PASS") {
    return text(document.passApprover) && parseUtc(document.passExpiry) != null
      && !Object.hasOwn(document, "notApplicableReason")
      && !Object.hasOwn(document, "notApplicableApprover");
  }
  if (document.status === "NOT_APPLICABLE") {
    return text(document.notApplicableReason) && text(document.notApplicableApprover)
      && !Object.hasOwn(document, "passApprover")
      && !Object.hasOwn(document, "passExpiry");
  }
  return !Object.hasOwn(document, "passApprover")
    && !Object.hasOwn(document, "passExpiry")
    && !Object.hasOwn(document, "notApplicableReason")
    && !Object.hasOwn(document, "notApplicableApprover");
}

function incidentReady(document) {
  if (!STATUSES.includes(document.status)) return false;
  if (!text(document.fingerprint) || !text(document.route)) return false;
  if (!optionalText(document.release) || !optionalText(document.suspectedCause) || !optionalText(document.owner)) {
    return false;
  }
  if (document.confidence !== null) return false;
  if (typeof document.seenCount !== "number" || !Number.isSafeInteger(document.seenCount) || document.seenCount < 0) {
    return false;
  }
  const first = parseUtc(document.firstSeen);
  const last = parseUtc(document.lastSeen);
  return first != null && last != null && last >= first;
}

function fieldsReady(document) {
  if (document.kind === "symbol") {
    return SYMBOL.test(document.symbol)
      && text(document.venue)
      && SYMBOL.test(document.base)
      && SYMBOL.test(document.quote)
      && text(document.contractType);
  }
  if (document.kind === "venue") {
    return text(document.venue)
      && VENUE_KINDS.includes(document.venueKind)
      && text(document.product)
      && text(document.docsReference)
      && text(document.region);
  }
  if (document.kind === "token") {
    return text(document.chain)
      && text(document.tokenAddress)
      && SYMBOL.test(document.symbol)
      && typeof document.decimals === "number"
      && Number.isSafeInteger(document.decimals)
      && document.decimals >= 0;
  }
  if (document.kind === "prediction") {
    return SYMBOL.test(document.asset)
      && text(document.venue)
      && text(document.horizon)
      && text(document.direction)
      && text(document.modelVersion)
      && text(document.probability);
  }
  if (document.kind === "checklist item") return checklistStatus(document);
  if (document.kind === "incident") return incidentReady(document);
  if (document.kind === "runbook") return text(document.title) && text(document.summary);
  return false;
}

function project(document, visibility) {
  const row = { schema: SEARCH_DOCUMENT_SCHEMA };
  for (const key of KIND_KEYS[document.kind]) {
    row[key] = key === "visibility" ? copyVisibility(visibility) : document[key];
  }
  return row;
}

function publish(row, visibility) {
  const copy = {};
  for (const key of Object.keys(row)) {
    copy[key] = key === "visibility" ? copyVisibility(visibility) : row[key];
  }
  return Object.freeze(copy);
}

function currentVisibility(index, row) {
  const history = index.visibilityById[row.id];
  if (!Array.isArray(history) || history.length === 0) return row.visibility;
  return history[history.length - 1];
}

function store(index) {
  if (!index || !Array.isArray(index.documents) || typeof index.nextId !== "number") return null;
  if (!plainObject(index.visibilityById)) return null;
  return index;
}

function visibleTo(actor, row, visibility) {
  if (row.tenantId !== actor.tenantId) return false;
  if (!canReadChecklistStatus(actor, row.tenantId)) return false;
  return visibility.includes(actor.role);
}

export function createSearchIndex() {
  return { nextId: 1, documents: [], visibilityById: {} };
}

export function indexSearchDocument(index, input) {
  const target = store(index);
  if (!target || !plainObject(input) || !plainObject(input.document)) return fail("unsupported field");
  const document = input.document;
  const blocked = rejection(document);
  if (blocked) return fail(blocked);
  if (unknownKey(input, INDEX_INPUT_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  if (!text(document.kind) || !SEARCH_DOCUMENT_KINDS.includes(document.kind)) return fail("unsupported field");
  const allowed = KIND_KEYS[document.kind];
  const required = allowed.filter((key) => !OPTIONAL_KEYS.has(key));
  if (unknownKey(document, allowed) || !requireKeys(document, required) || !text(document.version)) {
    return fail("unsupported field");
  }
  const visibility = visibilityList(document.visibility);
  if (!text(document.tenantId) || !visibility) return fail("unsupported field");
  if (document.tenantId !== actor.tenantId || !canEditChecklist(actor, document.tenantId)) return denied();
  if (!fieldsReady(document)) return fail("unsupported field");
  const row = project(document, visibility);
  row.id = `search-${target.nextId}`;
  target.nextId += 1;
  target.visibilityById[row.id] = [copyVisibility(visibility)];
  target.documents.push(row);
  return { ok: true, blocked: null, document: publish(row, visibility) };
}

export function reviseSearchVisibility(index, input) {
  const target = store(index);
  if (!target || !plainObject(input)) return fail("unsupported field");
  if (unknownKey(input, REVISE_INPUT_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  if (!text(input.documentId)) return fail("unsupported field");
  const row = target.documents.find((item) => item.id === input.documentId);
  if (!row || row.tenantId !== actor.tenantId || !canEditChecklist(actor, row.tenantId)) return denied();
  const history = target.visibilityById[row.id];
  if (!Array.isArray(history) || history.length === 0) return fail("unsupported field");
  const visibility = visibilityList(input.visibility);
  if (!visibility) return fail("unsupported field");
  const copy = copyVisibility(visibility);
  history.push(copy);
  return { ok: true, blocked: null, document: publish(row, copy) };
}

export function querySearchDocuments(index, input) {
  const target = store(index);
  if (!target) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, QUERY_INPUT_KEYS)) return denied();
  const actor = actorOf(input);
  if (!actor) return denied();
  const documents = [];
  for (const row of target.documents) {
    const visibility = currentVisibility(target, row);
    if (visibleTo(actor, row, visibility)) documents.push(publish(row, visibility));
  }
  return { ok: true, blocked: null, documents: Object.freeze(documents) };
}

export function readSearchDocuments(index, input) {
  return querySearchDocuments(index, input);
}
