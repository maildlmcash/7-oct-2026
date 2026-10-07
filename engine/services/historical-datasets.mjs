// Permitted historical datasets for TASK 13.A.02.
// A dataset is stored only with provenance, rights, timezone, gaps, and exclusions.
// Rights are public, licensed, or user-authorized. Unknown or unlicensed data is excluded.
// Another bot's private history is not stored without authorization.
// This module does not fetch a dataset and does not place an order.

const RIGHTS = new Set(["public", "licensed", "user-authorized"]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const IMPORT_KEYS = Object.freeze([
  "actor",
  "datasetId",
  "provenance",
  "rights",
  "timezone",
  "gaps",
  "exclusions",
  "privateBotHistory",
  "authorization",
]);
const PROVENANCE_KEYS = Object.freeze(["source", "reference"]);
const READ_KEYS = Object.freeze(["actor", "datasetId"]);
const ACTOR_KEYS = Object.freeze(["id", "role", "tenantId"]);

function fail(error) {
  return Object.freeze({
    ok: false,
    blocked: "BLOCKED",
    error,
    dataset: null,
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function filled(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function leaked(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (EMAIL.test(value)) return true;
  if (/bearer\s+/i.test(value)) return true;
  if (value.includes("BEGIN PRIVATE KEY")) return true;
  if (/seed phrase/i.test(value)) return true;
  return false;
}

function named(value, missing) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: missing };
  }
  if (!filled(value)) return { ok: false, error: "unsupported field" };
  if (leaked(value)) return { ok: false, error: "secret value is not allowed" };
  return { ok: true, value };
}

function actorOf(value) {
  if (!plainObject(value) || unknownKey(value, ACTOR_KEYS)) return { ok: false, error: "unsupported field" };
  const id = named(value.id, "role scope denied");
  if (!id.ok) return id;
  const tenantId = named(value.tenantId, "role scope denied");
  if (!tenantId.ok) return tenantId;
  if (value.role !== "Admin") return { ok: false, error: "role scope denied" };
  return { ok: true, actor: { id: id.value, role: value.role, tenantId: tenantId.value } };
}

function notes(value, missing) {
  if (!Array.isArray(value)) return { ok: false, error: "unsupported field" };
  const copy = [];
  for (const item of value) {
    const note = named(item, missing);
    if (!note.ok) return note;
    copy.push(note.value);
  }
  return { ok: true, value: Object.freeze(copy) };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createHistoricalDatasetStore() {
  return { datasets: new Map() };
}

export function importHistoricalDataset(store, input) {
  if (!store || !(store.datasets instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, IMPORT_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const datasetId = named(input.datasetId, "dataset is not configured");
  if (!datasetId.ok) return fail(datasetId.error);
  if (!plainObject(input.provenance) || unknownKey(input.provenance, PROVENANCE_KEYS)) {
    return fail("provenance is not configured");
  }
  const source = named(input.provenance.source, "provenance is not configured");
  if (!source.ok) return fail(source.error);
  const reference = named(input.provenance.reference, "provenance is not configured");
  if (!reference.ok) return fail(reference.error);
  if (!filled(input.rights) || !RIGHTS.has(input.rights)) {
    return fail("unlicensed or unknown data is excluded");
  }
  const timezone = named(input.timezone, "timezone is not configured");
  if (!timezone.ok) return fail(timezone.error);
  const gaps = notes(input.gaps, "gap is not configured");
  if (!gaps.ok) return fail(gaps.error);
  const exclusions = notes(input.exclusions, "exclusion is not configured");
  if (!exclusions.ok) return fail(exclusions.error);
  if (typeof input.privateBotHistory !== "boolean") return fail("unsupported field");
  if (input.authorization !== null && !filled(input.authorization)) return fail("unsupported field");
  if (input.authorization !== null && leaked(input.authorization)) return fail("secret value is not allowed");
  if (input.privateBotHistory) {
    if (input.rights !== "user-authorized" || input.authorization === null) {
      return fail("private history is not authorized");
    }
  }
  if (input.rights === "user-authorized" && input.authorization === null) {
    return fail("authorization is not configured");
  }
  const record = Object.freeze({
    datasetId: datasetId.value,
    tenantId: actor.actor.tenantId,
    provenance: Object.freeze({ source: source.value, reference: reference.value }),
    rights: input.rights,
    timezone: timezone.value,
    gaps: gaps.value,
    exclusions: exclusions.value,
    privateBotHistory: input.privateBotHistory,
    authorization: input.authorization,
  });
  const key = `${actor.actor.tenantId}\u0000${datasetId.value}`;
  const prior = store.datasets.get(key);
  if (prior) {
    if (!same(prior, record)) return fail("dataset is already recorded");
    return Object.freeze({ ok: true, blocked: null, error: null, dataset: prior });
  }
  store.datasets.set(key, record);
  return Object.freeze({ ok: true, blocked: null, error: null, dataset: record });
}

export function readHistoricalDataset(store, input) {
  if (!store || !(store.datasets instanceof Map)) return fail("unsupported field");
  if (!plainObject(input) || unknownKey(input, READ_KEYS)) return fail("unsupported field");
  const actor = actorOf(input.actor);
  if (!actor.ok) return fail(actor.error);
  const datasetId = named(input.datasetId, "dataset is not configured");
  if (!datasetId.ok) return fail(datasetId.error);
  const dataset = store.datasets.get(`${actor.actor.tenantId}\u0000${datasetId.value}`);
  if (!dataset) return fail("dataset is not configured");
  return Object.freeze({ ok: true, blocked: null, error: null, dataset });
}
