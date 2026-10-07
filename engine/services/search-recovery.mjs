// Search recovery drill for TASK 09.C.02.
// The test index is the in-memory store from services/search-documents.mjs.
// SHA-256 is an implementation choice. The source names no checksum algorithm.
// No search alias is installed, so alias rollback is refused and does not change the restored index.
// The degraded UI text matches the existing shell error boundary. This module does not open OpenSearch.

import { createHash } from "node:crypto";
import {
  createSearchIndex,
  indexSearchDocument,
  querySearchDocuments,
  reviseSearchVisibility,
} from "./search-documents.mjs";

const RUNBOOK_KEYS = Object.freeze(["owner", "testedAt"]);
const DRILL_KEYS = Object.freeze(["owner", "testedAt", "actor", "documents"]);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function dateReady(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function copyIndex(index) {
  return structuredClone({
    nextId: index.nextId,
    documents: index.documents,
    visibilityById: index.visibilityById,
  });
}

function stored(index) {
  return Boolean(index)
    && Array.isArray(index.documents)
    && typeof index.nextId === "number"
    && plainObject(index.visibilityById);
}

export function snapshotSearchIndex(index) {
  if (!stored(index)) return fail("unsupported field");
  const copy = copyIndex(index);
  const checksum = createHash("sha256").update(canonical(copy)).digest("hex");
  return Object.freeze({
    ok: true,
    blocked: null,
    count: copy.documents.length,
    checksum,
    index: copy,
  });
}

export function restoreSearchIndex(snapshot) {
  if (!plainObject(snapshot) || !stored(snapshot.index) || typeof snapshot.checksum !== "string") {
    return fail("unsupported field");
  }
  if (!Number.isSafeInteger(snapshot.count) || snapshot.count < 0) return fail("unsupported field");
  const index = copyIndex(snapshot.index);
  const checksum = createHash("sha256").update(canonical(index)).digest("hex");
  if (checksum !== snapshot.checksum || index.documents.length !== snapshot.count) {
    return fail("checksum mismatch");
  }
  return { ok: true, blocked: null, index, count: index.documents.length, checksum };
}

export function rollbackSearchAlias(input) {
  if (input !== undefined) return fail("unsupported field");
  return fail("search alias is not installed");
}

export function searchRecoveryRunbook(input) {
  if (!plainObject(input) || unknownKey(input, RUNBOOK_KEYS)) return fail("unsupported field");
  if (!filled(input.owner)) return fail("owner is required");
  if (!dateReady(input.testedAt)) return fail("last-tested date is required");
  const text = [
    "# Search recovery",
    "",
    `Owner: ${input.owner}`,
    `Last tested: ${input.testedAt}`,
    "",
    "The owner name is a drill fixture. The source names no operator.",
    "",
    "## Snapshot and restore",
    "",
    "The drill copies the in-memory search index, including document ids, visibility revisions, and the next id. SHA-256 of the canonical JSON is the checksum. The source names no checksum algorithm, so SHA-256 is an implementation choice. Restore replaces a damaged index with that copy. The restored document count and checksum match the snapshot. A raw order-book field is rejected and is not stored.",
    "",
    "## Alias rollback",
    "",
    "No search alias is installed. services/search-indexer/ is absent, and OpenSearch is not running. rollbackSearchAlias returns blocked BLOCKED with error search alias is not installed. The refusal leaves the restored checksum unchanged.",
    "",
    "## Partial outage",
    "",
    "The drill removes one stored document and then restores the snapshot. The damaged count is lower. The restored count and checksum match the snapshot. A same-tenant Customer still sees only documents whose current visibility includes Customer. A same-tenant Admin sees the restored documents. A cross-tenant read stays empty.",
    "",
    "## Degraded UI",
    "",
    "Search remains one of the seven section buttons. The section navigation and the heading stay outside the section error boundary. A render failure shows Section render failed and replaces that panel body. A failed view-state request shows Section request failed and leaves the section content mounted. The other section buttons stay in place. Live trading stays OFF.",
    "",
  ].join("\n");
  return { ok: true, blocked: null, owner: input.owner, testedAt: input.testedAt, text };
}

export function runSearchRecoveryDrill(input) {
  if (!plainObject(input) || unknownKey(input, DRILL_KEYS)) return fail("unsupported field");
  const runbook = searchRecoveryRunbook({ owner: input.owner, testedAt: input.testedAt });
  if (!runbook.ok) return runbook;
  if (!plainObject(input.actor) || !Array.isArray(input.documents) || input.documents.length < 2) {
    return fail("unsupported field");
  }
  const index = createSearchIndex();
  for (const document of input.documents) {
    const indexed = indexSearchDocument(index, { actor: input.actor, document });
    if (!indexed.ok) return indexed;
  }
  const revised = reviseSearchVisibility(index, {
    actor: input.actor,
    documentId: index.documents[0].id,
    visibility: ["Admin"],
  });
  if (!revised.ok) return revised;
  const before = querySearchDocuments(index, { actor: input.actor });
  if (!before.ok) return before;
  const shot = snapshotSearchIndex(index);
  if (!shot.ok) return shot;
  index.documents.pop();
  const damagedCount = index.documents.length;
  const restored = restoreSearchIndex(shot);
  if (!restored.ok) return restored;
  const after = querySearchDocuments(restored.index, { actor: input.actor });
  if (!after.ok) return after;
  const ids = before.documents.map((document) => document.id);
  const restoredIds = after.documents.map((document) => document.id);
  if (restored.count !== shot.count || restored.checksum !== shot.checksum || restoredIds.join() !== ids.join()) {
    return fail("checksum mismatch");
  }
  const otherTenant = input.actor.tenantId === "tenant-b" ? "tenant-a" : "tenant-b";
  const cross = querySearchDocuments(restored.index, {
    actor: { role: "Customer", tenantId: otherTenant },
  });
  if (!cross.ok || cross.documents.length !== 0) return fail("checksum mismatch");
  const aliasRollback = rollbackSearchAlias();
  const afterAlias = snapshotSearchIndex(restored.index);
  if (!afterAlias.ok || afterAlias.checksum !== restored.checksum) return fail("checksum mismatch");
  return {
    ok: true,
    blocked: null,
    count: shot.count,
    checksum: shot.checksum,
    damagedCount,
    restoredCount: restored.count,
    restoredChecksum: restored.checksum,
    ids,
    restoredIds,
    index: restored.index,
    aliasRollback,
    runbook: runbook.text,
  };
}
