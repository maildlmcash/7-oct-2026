import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as whales from "../services/whale-eligibility.mjs";
import {
  rankWhaleEligibility,
  readCurrentWhaleEligibility,
  WHALE_LIST_SIZE,
} from "../services/whale-eligibility.mjs";

// Caller fixtures. These are not published whale addresses and not a current top 15.
// usdValue, volume24h, and depth are present so materiality is not a fixed USD cutoff.
// Their amounts are NOT IN SOURCE.
const AS_OF = "2026-10-06T00:00:00Z";

function event(eventId, at, kind, direction, extra = {}) {
  return {
    eventId,
    at,
    asset: "BTC",
    kind,
    internal: false,
    selfTransfer: false,
    usdValue: "1",
    volume24h: "1",
    depth: "1",
    direction,
    ...extra,
  };
}

function goodEntity(n, overrides = {}) {
  const id = String(n).padStart(2, "0");
  return {
    entityId: `fixture-${id}`,
    addresses: [`fixture-address-${id}`],
    chain: "Ethereum",
    labels: [],
    labelSource: "fixture",
    attributionConfidence: "1",
    activityRecency: n === 1 ? "0.5" : "1",
    liquidityRelativeSize: "1",
    verifiedExternalFlow: "1",
    historicalImpact: "1",
    evidence: {
      source: "fixture",
      reference: `fixture-evidence-${id}`,
      observedAt: "2026-10-05T00:00:00Z",
      verifiedAt: "2026-10-05T12:00:00Z",
    },
    events: [
      event(`e-${id}-1`, "2026-10-05T00:00:00Z", "dex swap", "buy"),
      event(`e-${id}-2`, "2026-09-20T00:00:00Z", "venue flow", "sell"),
      event(`e-${id}-3`, "2026-09-10T00:00:00Z", "verified execution", "buy"),
    ],
    ...overrides,
  };
}

function fifteen() {
  return Array.from({ length: 15 }, (_, index) => goodEntity(index + 1));
}

function reason(result, entityId) {
  return result.exclusions.find((row) => row.entityId === entityId);
}

test("inactive, exchange, bridge, and self-transfer entities are excluded with reasons", () => {
  const entities = [
    goodEntity(1, { entityId: "dormant-one", labels: ["dormant"], addresses: ["fixture-address-dormant"] }),
    goodEntity(2, { entityId: "deactivated-one", labels: ["deactivated"], addresses: ["fixture-address-deactivated"] }),
    goodEntity(3, { entityId: "exchange-one", labels: ["exchange"], addresses: ["fixture-address-exchange"] }),
    goodEntity(4, { entityId: "bridge-one", labels: ["bridge"], addresses: ["fixture-address-bridge"] }),
    goodEntity(5, {
      entityId: "self-label",
      labels: ["self-transfer"],
      addresses: ["fixture-address-self"],
    }),
    goodEntity(6, {
      entityId: "self-events",
      addresses: ["fixture-address-own"],
      events: [
        event("s1", "2026-10-05T00:00:00Z", "transfer", "buy", { from: "fixture-address-own", to: "fixture-address-own" }),
        event("s2", "2026-09-20T00:00:00Z", "transfer", "sell", { selfTransfer: true }),
        event("s3", "2026-09-10T00:00:00Z", "transfer", "buy", { selfTransfer: true }),
      ],
    }),
    goodEntity(7, {
      entityId: "internal-only",
      addresses: ["fixture-address-internal"],
      events: [
        event("i1", "2026-10-05T00:00:00Z", "transfer", "buy", { internal: true }),
        event("i2", "2026-09-20T00:00:00Z", "transfer", null, { internal: true }),
        event("i3", "2026-09-10T00:00:00Z", "transfer", null, { internal: true }),
      ],
    }),
    goodEntity(8, {
      entityId: "stale-one",
      labelStale: true,
      addresses: ["fixture-address-stale"],
    }),
    goodEntity(9, {
      entityId: "low-one",
      attributionConfidence: "low",
      addresses: ["fixture-address-low"],
    }),
    goodEntity(10, {
      entityId: "quiet-recent",
      addresses: ["fixture-address-quiet"],
      events: [
        event("q1", "2026-09-28T00:00:00Z", "dex swap", "buy"),
        event("q2", "2026-09-20T00:00:00Z", "venue flow", "sell"),
        event("q3", "2026-09-10T00:00:00Z", "verified execution", "buy"),
      ],
    }),
    goodEntity(11, {
      entityId: "too-few",
      addresses: ["fixture-address-few"],
      events: [
        event("f1", "2026-10-05T00:00:00Z", "dex swap", "buy"),
        event("f2", "2026-09-20T00:00:00Z", "venue flow", "sell"),
      ],
    }),
    goodEntity(12, {
      entityId: "old-activity",
      addresses: ["fixture-address-old"],
      events: [
        event("o1", "2026-08-01T00:00:00Z", "dex swap", "buy"),
        event("o2", "2026-07-20T00:00:00Z", "venue flow", "sell"),
        event("o3", "2026-07-01T00:00:00Z", "verified execution", "buy"),
      ],
    }),
    goodEntity(13, {
      entityId: "usd-only",
      addresses: ["fixture-address-usd"],
      events: [
        event("u1", "2026-10-05T00:00:00Z", "dex swap", "buy", { volume24h: undefined, depth: undefined }),
      ],
    }),
    goodEntity(14, {
      entityId: "shared-a",
      addresses: ["fixture-shared"],
    }),
    goodEntity(15, {
      entityId: "shared-b",
      addresses: ["fixture-shared"],
    }),
    goodEntity(16, {
      entityId: "priced",
      addresses: ["fixture-address-priced"],
      price: "0.001",
      identity: "Satoshi",
    }),
  ];
  const result = rankWhaleEligibility({ asOf: AS_OF, entities });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "BLOCKED");
  assert.equal(result.error, "evidence is insufficient");
  assert.equal(result.entries.length, 0);
  assert.equal(reason(result, "dormant-one").reason, "dormant");
  assert.equal(reason(result, "deactivated-one").reason, "deactivated");
  assert.equal(reason(result, "exchange-one").reason, "exchange wallet");
  assert.equal(reason(result, "bridge-one").reason, "bridge wallet");
  assert.equal(reason(result, "self-label").reason, "self-transfer");
  assert.equal(reason(result, "self-events").reason, "self-transfer");
  assert.match(reason(result, "self-events").explanation, /not buys, sells/);
  assert.equal(reason(result, "internal-only").reason, "exchange wallet");
  assert.equal(reason(result, "stale-one").reason, "stale label");
  assert.equal(reason(result, "low-one").reason, "low attribution confidence");
  assert.equal(reason(result, "quiet-recent").reason, "no recent movement");
  assert.equal(reason(result, "quiet-recent").lastSeen, "2026-09-28T00:00:00Z");
  assert.equal(reason(result, "too-few").reason, "activity gate");
  assert.equal(reason(result, "old-activity").reason, "no material activity");
  assert.equal(reason(result, "usd-only").reason, "activity gate");
  assert.equal(reason(result, "shared-a").reason, "duplicate address");
  assert.equal(reason(result, "shared-b").reason, "duplicate address");
  assert.equal(reason(result, "priced").reason, "evidence is insufficient");
  assert.equal(JSON.stringify(result).includes("0.001"), false);
  assert.equal(JSON.stringify(result).includes("Satoshi"), false);
});

test("fifteen fixture entities with evidence are ranked and a short list stays blocked", () => {
  const entities = fifteen();
  entities[14] = goodEntity(15, {
    events: [
      event("edge-1", "2026-09-29T00:00:00Z", "dex swap", "buy"),
      event("edge-2", "2026-09-15T00:00:00Z", "venue flow", "sell"),
      event("edge-3", "2026-09-06T00:00:00Z", "verified execution", null),
    ],
  });
  const ranked = rankWhaleEligibility({ asOf: AS_OF, entities });
  assert.equal(ranked.ok, true);
  assert.equal(ranked.blocked, null);
  assert.equal(ranked.entries.length, WHALE_LIST_SIZE);
  assert.equal(ranked.entries.length, 15);
  assert.equal(ranked.entries[14].entityId, "fixture-01");
  assert.equal(ranked.entries[14].whaleRank, "0.85");
  assert.equal(ranked.entries[14].rank, 15);
  assert.equal(ranked.entries[0].entityId, "fixture-02");
  assert.equal(ranked.entries[0].whaleRank, "1");
  for (const entry of ranked.entries) {
    assert.equal(entry.identity, "unlabelled entity");
    assert.equal(typeof entry.lastSeen, "string");
    assert.equal(typeof entry.verifiedAt, "string");
    assert.equal(typeof entry.evidence.reference, "string");
    assert.equal(typeof entry.evidence.observedAt, "string");
    assert.equal(entry.asOf, undefined);
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(ranked.asOf, AS_OF);
  assert.equal(ranked.observationWindow.recentDays, 7);
  assert.equal(ranked.observationWindow.activityDays, 30);
  const edge = ranked.entries.find((entry) => entry.entityId === "fixture-15");
  assert.equal(edge.lastSeen, "2026-09-29T00:00:00Z");
  assert.ok(edge);

  const short = rankWhaleEligibility({ asOf: AS_OF, entities: fifteen().slice(0, 14) });
  assert.equal(short.blocked, "BLOCKED");
  assert.equal(short.error, "evidence is insufficient");
  assert.equal(short.entries.length, 0);
  assert.equal(short.eligibleCount, 14);

  const current = readCurrentWhaleEligibility();
  assert.equal(current.ok, false);
  assert.equal(current.blocked, "BLOCKED");
  assert.equal(current.error, "evidence is insufficient");
  assert.equal(current.entries.length, 0);
  assert.equal(current.asOf, null);
  assert.equal(JSON.stringify(current).includes("fixture-address"), false);
});

test("a boundary tie is blocked and a transfer is not a buy or a sell", () => {
  const tied = rankWhaleEligibility({
    asOf: AS_OF,
    entities: Array.from({ length: 16 }, (_, index) => goodEntity(index + 1, {
      activityRecency: "1",
      entityId: `tie-${String(index + 1).padStart(2, "0")}`,
      addresses: [`tie-address-${index + 1}`],
    })),
  });
  assert.equal(tied.blocked, "BLOCKED");
  assert.equal(tied.error, "tie at rank boundary");
  assert.equal(tied.entries.length, 0);
  assert.equal(tied.tiedEntityIds.length, 16);

  const entities = fifteen();
  entities[0] = goodEntity(1, {
    events: [
      event("t1", "2026-10-05T00:00:00Z", "transfer", "buy"),
      event("t2", "2026-09-20T00:00:00Z", "transfer", "sell"),
      event("t3", "2026-09-10T00:00:00Z", "transfer", "buy"),
    ],
  });
  const ranked = rankWhaleEligibility({ asOf: AS_OF, entities });
  assert.equal(ranked.blocked, null);
  const transfer = ranked.entries.find((entry) => entry.entityId === "fixture-01");
  assert.equal(transfer.flowDirection, null);
  assert.equal(JSON.stringify(transfer).includes("buy"), false);
  assert.equal(JSON.stringify(transfer).includes("sell"), false);

  const lower = goodEntity(16, {
    entityId: "fixture-16",
    addresses: ["fixture-address-16"],
    activityRecency: "0",
    liquidityRelativeSize: "0",
    attributionConfidence: "0.20",
    verifiedExternalFlow: "0",
    historicalImpact: "0",
  });
  const withheld = rankWhaleEligibility({ asOf: AS_OF, entities: fifteen().concat(lower) });
  assert.equal(withheld.blocked, null);
  assert.equal(withheld.entries.length, 15);
  assert.equal(withheld.withheld.length, 1);
  assert.equal(withheld.withheld[0].entityId, "fixture-16");
  assert.equal(withheld.withheld[0].reason, "outside top 15");
  assert.equal(withheld.entries.some((entry) => entry.entityId === "fixture-16"), false);
});

test("paper mode stays locked and the module does not export an order", () => {
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
  for (const name of ["placeOrder", "fill", "submit"]) {
    assert.equal(Object.hasOwn(whales, name), false);
  }
});
