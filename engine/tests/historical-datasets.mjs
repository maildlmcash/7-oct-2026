import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as datasets from "../services/historical-datasets.mjs";
import {
  createHistoricalDatasetStore,
  importHistoricalDataset,
  readHistoricalDataset,
} from "../services/historical-datasets.mjs";

const admin = { id: "fixture-admin", role: "Admin", tenantId: "tenant-1" };
const other = { id: "fixture-other", role: "Admin", tenantId: "tenant-2" };
const customer = { id: "fixture-customer", role: "Customer", tenantId: "tenant-1" };

function record(extra) {
  return {
    actor: admin,
    datasetId: "fixture-dataset",
    provenance: { source: "fixture-source", reference: "fixture-reference" },
    rights: "public",
    timezone: "UTC",
    gaps: ["fixture-gap"],
    exclusions: ["fixture-exclusion"],
    privateBotHistory: false,
    authorization: null,
    ...extra,
  };
}

test("a permitted dataset keeps provenance and an excluded dataset is not stored", () => {
  const store = createHistoricalDatasetStore();
  const imported = importHistoricalDataset(store, record());
  assert.equal(imported.ok, true, imported.error);
  assert.equal(imported.dataset.provenance.source, "fixture-source");
  assert.equal(imported.dataset.provenance.reference, "fixture-reference");
  assert.equal(imported.dataset.rights, "public");
  assert.equal(imported.dataset.timezone, "UTC");
  assert.deepEqual(imported.dataset.gaps, ["fixture-gap"]);
  assert.deepEqual(imported.dataset.exclusions, ["fixture-exclusion"]);
  const again = importHistoricalDataset(store, record());
  assert.deepEqual(again.dataset, imported.dataset);
  const read = readHistoricalDataset(store, { actor: admin, datasetId: "fixture-dataset" });
  assert.deepEqual(read.dataset, imported.dataset);
  assert.equal(store.datasets.size, 1);

  const licensed = importHistoricalDataset(store, record({
    datasetId: "fixture-licensed",
    rights: "licensed",
    gaps: [],
    exclusions: [],
  }));
  assert.equal(licensed.ok, true, licensed.error);
  assert.equal(licensed.dataset.rights, "licensed");

  const authorized = importHistoricalDataset(store, record({
    datasetId: "fixture-log",
    rights: "user-authorized",
    privateBotHistory: true,
    authorization: "fixture-authorization",
  }));
  assert.equal(authorized.ok, true, authorized.error);
  assert.equal(authorized.dataset.privateBotHistory, true);
  assert.equal(authorized.dataset.authorization, "fixture-authorization");
});

test("unknown rights and unauthorized private history stay excluded", () => {
  const store = createHistoricalDatasetStore();
  const guessed = importHistoricalDataset(store, record({ rights: "guessed" }));
  assert.equal(guessed.blocked, "BLOCKED");
  assert.equal(guessed.error, "unlicensed or unknown data is excluded");
  assert.equal(guessed.dataset, null);
  assert.equal(JSON.stringify(guessed).includes("guessed"), false);
  assert.equal(readHistoricalDataset(store, { actor: admin, datasetId: "fixture-dataset" }).error, "dataset is not configured");

  const privateHistory = importHistoricalDataset(store, record({
    datasetId: "fixture-private",
    rights: "public",
    privateBotHistory: true,
    authorization: null,
  }));
  assert.equal(privateHistory.error, "private history is not authorized");
  assert.equal(store.datasets.size, 0);

  const missingAuth = importHistoricalDataset(store, record({
    datasetId: "fixture-auth",
    rights: "user-authorized",
    authorization: null,
  }));
  assert.equal(missingAuth.error, "authorization is not configured");

  const missingProvenance = importHistoricalDataset(store, record({ provenance: { source: "fixture-source" } }));
  assert.equal(missingProvenance.error, "provenance is not configured");

  const denied = importHistoricalDataset(store, record({ actor: customer }));
  assert.equal(denied.error, "role scope denied");
  assert.equal(denied.dataset, null);

  importHistoricalDataset(store, record());
  const cross = readHistoricalDataset(store, { actor: other, datasetId: "fixture-dataset" });
  assert.equal(cross.error, "dataset is not configured");
  assert.equal(cross.dataset, null);
});

test("the historical dataset export is closed and live trading stays off", () => {
  assert.deepEqual(Object.keys(datasets).sort(), [
    "createHistoricalDatasetStore",
    "importHistoricalDataset",
    "readHistoricalDataset",
  ]);
  const source = readFileSync(new URL("../services/historical-datasets.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
