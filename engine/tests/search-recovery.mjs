import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as recovery from "../services/search-recovery.mjs";
import {
  rollbackSearchAlias,
  runSearchRecoveryDrill,
  searchRecoveryRunbook,
} from "../services/search-recovery.mjs";
import { querySearchDocuments } from "../services/search-documents.mjs";

// The owner name is NOT IN SOURCE. The last-tested date is the drill clock.
const OWNER = "fixture-owner";
const TESTED_AT = "2026-10-06";
const ACTOR = { role: "Admin", tenantId: "tenant-a" };
const CUSTOMER = { role: "Customer", tenantId: "tenant-a" };

function document(kind, fields) {
  return {
    kind,
    version: "fixture-1",
    tenantId: "tenant-a",
    visibility: ["Admin", "Customer"],
    ...fields,
  };
}

test("recovery drill restores the test index and the runbook names owner and date", () => {
  const drill = runSearchRecoveryDrill({
    owner: OWNER,
    testedAt: TESTED_AT,
    actor: ACTOR,
    documents: [
      document("symbol", {
        symbol: "BTC",
        venue: "Binance",
        base: "BTC",
        quote: "USDT",
        contractType: "Spot",
      }),
      document("runbook", {
        title: "Rollback",
        summary: "Recovery drill for the release.",
      }),
    ],
  });
  assert.equal(drill.ok, true, drill.error);
  assert.equal(drill.blocked, null);
  assert.equal(drill.count, 2);
  assert.equal(drill.damagedCount, 1);
  assert.equal(drill.restoredCount, 2);
  assert.equal(drill.restoredChecksum, drill.checksum);
  assert.match(drill.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(drill.restoredIds, drill.ids);
  assert.equal(drill.aliasRollback.ok, false);
  assert.equal(drill.aliasRollback.blocked, "BLOCKED");
  assert.equal(drill.aliasRollback.error, "search alias is not installed");

  const admin = querySearchDocuments(drill.index, { actor: ACTOR });
  const customer = querySearchDocuments(drill.index, { actor: CUSTOMER });
  assert.equal(admin.documents.length, 2);
  assert.deepEqual(admin.documents[0].visibility, ["Admin"]);
  assert.deepEqual(customer.documents.map((item) => item.kind), ["runbook"]);

  const runbook = searchRecoveryRunbook({ owner: OWNER, testedAt: TESTED_AT });
  const filed = readFileSync(new URL("../docs/runbooks/search-recovery.md", import.meta.url), "utf8");
  assert.equal(runbook.ok, true);
  assert.equal(runbook.owner, OWNER);
  assert.equal(runbook.testedAt, TESTED_AT);
  assert.equal(filed, runbook.text);
  assert.equal(drill.runbook, filed);
  assert.match(filed, /^Owner: fixture-owner$/m);
  assert.match(filed, /^Last tested: 2026-10-06$/m);

  const shell = readFileSync(new URL("../apps/web/app/shell.tsx", import.meta.url), "utf8");
  const boundary = readFileSync(new URL("../apps/web/app/section-boundary.tsx", import.meta.url), "utf8");
  assert.ok(shell.indexOf("<SectionNav") < shell.indexOf("<SectionErrorBoundary"));
  assert.match(boundary, /Section render failed/);
  assert.match(boundary, /Section request failed/);
  assert.match(boundary, /\{children\}/);
  assert.match(filed, /Section render failed/);
  assert.match(filed, /Section request failed/);
  assert.match(filed, /search alias is not installed/);
});

test("a missing owner, a bad date, and a tick field fail closed", () => {
  assert.equal(searchRecoveryRunbook({ testedAt: TESTED_AT }).error, "owner is required");
  assert.equal(searchRecoveryRunbook({ owner: OWNER }).error, "last-tested date is required");
  assert.equal(searchRecoveryRunbook({ owner: OWNER, testedAt: "2026-02-31" }).error, "last-tested date is required");
  assert.equal(rollbackSearchAlias({ alias: "search" }).error, "unsupported field");

  const ticks = runSearchRecoveryDrill({
    owner: OWNER,
    testedAt: TESTED_AT,
    actor: ACTOR,
    documents: [
      document("symbol", {
        symbol: "BTC",
        venue: "Binance",
        base: "BTC",
        quote: "USDT",
        contractType: "Spot",
        bids: [["1", "1"]],
        asks: [["2", "1"]],
      }),
      document("runbook", {
        title: "Rollback",
        summary: "Recovery drill for the release.",
      }),
    ],
  });
  assert.equal(ticks.ok, false);
  assert.equal(ticks.error, "raw order book");
  assert.equal(Object.hasOwn(ticks, "checksum"), false);
  assert.equal(JSON.stringify(ticks).includes("bids"), false);
});

test("paper mode stays locked and the module does not export an order", () => {
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(recovery, name), false);
  }
});
