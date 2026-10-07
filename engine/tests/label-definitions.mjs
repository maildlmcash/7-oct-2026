import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import * as labels from "../services/label-definitions.mjs";
import {
  LABEL_TARGET_RETURN,
  SPOT_HORIZONS,
  createLabelStore,
  labelOutcome,
  readLabelVersion,
  registerLabelVersion,
} from "../services/label-definitions.mjs";

// Event time 1499865549590 is the existing trade fixture.
// Dead zone 0.01 and the one-day windows are caller fixtures.
// The source names no dead-zone width and no observation length.
// One minute is 60000 ms because the Spot horizon is 1m.
const TIME = 1499865549590;
const MINUTE = 60000;
const DAY = 86400000;

function book(bid, ask, time) {
  return { bid, ask, time };
}

function definition(version, patch) {
  return {
    version,
    horizons: [...SPOT_HORIZONS],
    deadZone: "0.01",
    observationWindow: { from: TIME, to: TIME + DAY },
    testWindow: { from: TIME + DAY + 1, to: TIME + DAY + DAY },
    ...patch,
  };
}

function sample(patch) {
  return {
    version: "fixture-label-1",
    horizon: "1m",
    cutoff: TIME,
    start: book("99", "101", TIME),
    outcome: book("100", "102", TIME + MINUTE),
    quality: { healthy: true, reason: null },
    ...patch,
  };
}

test("rise, fall, and neutral follow the dead-zone boundary and the horizon clock", () => {
  const store = createLabelStore();
  const registered = registerLabelVersion(store, definition("fixture-label-1"));
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.definition.cutoff, String(TIME + DAY));
  assert.equal(registered.definition.targetReturn, "future mid-price return");
  assert.equal(registered.definition.costsApplied, false);
  assert.deepEqual(registered.definition.horizons, ["1m", "5m", "15m", "1h"]);

  const neutral = labelOutcome(store, sample());
  const again = labelOutcome(store, structuredClone(sample()));
  assert.equal(neutral.ok, true, neutral.error);
  assert.equal(neutral.label, "neutral");
  assert.equal(neutral.return, "0.01");
  assert.equal(neutral.cutoff, String(TIME));
  assert.equal(neutral.outcomeTime, String(TIME + MINUTE));
  assert.equal(neutral.costsApplied, false);
  assert.deepEqual(again, neutral);

  const lower = labelOutcome(store, sample({
    cutoff: TIME + MINUTE,
    start: book("99", "101", TIME + MINUTE),
    outcome: book("98", "100", TIME + MINUTE + MINUTE),
  }));
  assert.equal(lower.label, "neutral");
  assert.equal(lower.return, "-0.01");

  const flat = labelOutcome(store, sample({
    cutoff: TIME + MINUTE + MINUTE,
    start: book("99", "101", TIME + MINUTE + MINUTE),
    outcome: book("99", "101", TIME + MINUTE + MINUTE + MINUTE),
  }));
  assert.equal(flat.label, "neutral");
  assert.equal(flat.return, "0");

  const rise = labelOutcome(store, sample({
    cutoff: TIME + MINUTE * 3,
    start: book("99", "101", TIME + MINUTE * 3),
    outcome: book("100.2", "102.2", TIME + MINUTE * 4),
  }));
  assert.equal(rise.label, "rise");
  assert.equal(rise.return, "0.012");

  const fall = labelOutcome(store, sample({
    cutoff: TIME + MINUTE * 4,
    start: book("99", "101", TIME + MINUTE * 4),
    outcome: book("97.8", "99.8", TIME + MINUTE * 5),
  }));
  assert.equal(fall.label, "fall");
  assert.equal(fall.return, "-0.012");

  const zeroBand = registerLabelVersion(store, definition("fixture-label-0", { deadZone: "0" }));
  assert.equal(zeroBand.ok, true, zeroBand.error);
  const up = labelOutcome(store, sample({
    version: "fixture-label-0",
    outcome: book("100", "102", TIME + MINUTE),
  }));
  assert.equal(up.label, "rise");
  assert.equal(up.return, "0.01");
  const down = labelOutcome(store, sample({
    version: "fixture-label-0",
    cutoff: TIME + MINUTE,
    start: book("99", "101", TIME + MINUTE),
    outcome: book("98", "100", TIME + MINUTE + MINUTE),
  }));
  assert.equal(down.label, "fall");
  const unchanged = labelOutcome(store, sample({
    version: "fixture-label-0",
    cutoff: TIME + MINUTE + MINUTE,
    start: book("99", "101", TIME + MINUTE + MINUTE),
    outcome: book("99", "101", TIME + MINUTE + MINUTE + MINUTE),
  }));
  assert.equal(unchanged.label, "neutral");
  assert.equal(unchanged.return, "0");
});

test("a misaligned clock, a stale source, and an overlap publish no class", () => {
  const store = createLabelStore();
  registerLabelVersion(store, definition("fixture-label-1"));

  const lateClock = labelOutcome(store, sample({
    outcome: book("100", "102", TIME + MINUTE + 1),
  }));
  assert.equal(lateClock.ok, false);
  assert.equal(lateClock.error, "timestamp is not aligned");
  assert.equal(lateClock.label, null);
  assert.equal(lateClock.horizon, "1m");

  const earlyStart = labelOutcome(store, sample({
    start: book("99", "101", TIME - 1),
  }));
  assert.equal(earlyStart.error, "timestamp is not aligned");
  assert.equal(earlyStart.label, null);

  const ahead = labelOutcome(store, sample({
    start: book("99", "101", TIME + 1),
  }));
  assert.equal(ahead.error, "lookahead window");
  assert.equal(ahead.label, null);
  assert.equal(JSON.stringify(ahead).includes("101"), false);

  const stale = labelOutcome(store, sample({
    quality: { healthy: false, reason: "stale stream" },
  }));
  assert.equal(stale.vetoed, true);
  assert.equal(stale.label, null);
  assert.equal(stale.return, null);
  assert.equal(stale.error, "stale stream");
  assert.equal(JSON.stringify(stale).includes("neutral"), false);

  const degraded = labelOutcome(store, sample({ quality: "degraded" }));
  assert.equal(degraded.vetoed, true);
  assert.equal(degraded.error, "degraded");
  assert.equal(degraded.label, null);

  const hidden = labelOutcome(store, sample({
    quality: { healthy: false, reason: "secret-reason" },
  }));
  assert.equal(hidden.error, "invalid source");
  assert.equal(JSON.stringify(hidden).includes("secret-reason"), false);

  const crossed = labelOutcome(store, sample({
    outcome: book("103", "102", TIME + MINUTE),
  }));
  assert.equal(crossed.error, "mid price is missing");
  assert.equal(crossed.label, null);

  const next = labelOutcome(store, sample());
  assert.equal(next.ok, true, next.error);
  const overlap = labelOutcome(store, sample({
    cutoff: TIME + MINUTE / 2,
    start: book("99", "101", TIME + MINUTE / 2),
    outcome: book("100", "102", TIME + MINUTE / 2 + MINUTE),
  }));
  assert.equal(overlap.error, "overlapping window");
  assert.equal(overlap.label, null);
  assert.equal(labelOutcome(store, sample()).label, "neutral");

  const adjacent = labelOutcome(store, sample({
    cutoff: TIME + MINUTE,
    start: book("99", "101", TIME + MINUTE),
    outcome: book("100", "102", TIME + MINUTE + MINUTE),
  }));
  assert.equal(adjacent.ok, true, adjacent.error);
  const five = labelOutcome(store, sample({
    horizon: "5m",
    outcome: book("100", "102", TIME + MINUTE * 5),
  }));
  assert.equal(five.ok, true, five.error);
  assert.equal(five.horizon, "5m");
  assert.equal(five.outcomeTime, String(TIME + MINUTE * 5));
  const hour = labelOutcome(store, sample({
    horizon: "1h",
    outcome: book("100", "102", TIME + 3600000),
  }));
  assert.equal(hour.ok, true, hour.error);
  assert.equal(hour.outcomeTime, String(TIME + 3600000));
  const quarter = labelOutcome(store, sample({
    horizon: "15m",
    outcome: book("100", "102", TIME + MINUTE * 15),
  }));
  assert.equal(quarter.ok, true, quarter.error);
  assert.equal(quarter.outcomeTime, String(TIME + MINUTE * 15));

  const foreign = labelOutcome(store, sample({ horizon: "4h" }));
  assert.equal(foreign.error, "horizon is not supported");
  assert.equal(foreign.horizon, null);
  assert.equal(JSON.stringify(foreign).includes("4h"), false);
});

test("the test window cannot tune the stored dead zone", () => {
  const store = createLabelStore();
  const registered = registerLabelVersion(store, definition("fixture-label-1"));
  assert.equal(registered.ok, true, registered.error);
  const same = registerLabelVersion(store, definition("fixture-label-1", { deadZone: "0.0100" }));
  assert.equal(same.ok, true, same.error);
  assert.equal(same.deadZone, "0.01");

  const tuned = registerLabelVersion(store, definition("fixture-label-1", {
    deadZone: "0.02",
    observationWindow: { from: TIME + DAY + 1, to: TIME + DAY + DAY },
  }));
  assert.equal(tuned.ok, false);
  assert.equal(tuned.error, "test window is not for tuning");
  assert.equal(tuned.deadZone, "0.01");
  assert.equal(readLabelVersion(store, { version: "fixture-label-1" }).deadZone, "0.01");

  const replaced = registerLabelVersion(store, definition("fixture-label-1", {
    deadZone: "0.02",
    observationWindow: { from: TIME + DAY + DAY + 1, to: TIME + DAY + DAY + DAY },
    testWindow: { from: TIME + DAY + DAY + DAY + 1, to: TIME + DAY + DAY + DAY + DAY },
  }));
  assert.equal(replaced.error, "label version is already registered");
  assert.equal(readLabelVersion(store, { version: "fixture-label-1" }).definition.deadZone, "0.01");

  const overlapped = registerLabelVersion(store, definition("fixture-label-2", {
    observationWindow: { from: TIME, to: TIME + DAY },
    testWindow: { from: TIME + DAY, to: TIME + DAY + DAY },
  }));
  assert.equal(overlapped.error, "overlapping window");
  assert.equal(readLabelVersion(store, { version: "fixture-label-2" }).error, "label version is not configured");

  const inside = labelOutcome(store, sample({
    cutoff: TIME + DAY + 1,
    start: book("99", "101", TIME + DAY + 1),
    outcome: book("100.2", "102.2", TIME + DAY + 1 + MINUTE),
  }));
  assert.equal(inside.ok, true, inside.error);
  assert.equal(inside.label, "rise");
  assert.equal(inside.deadZone, "0.01");
  assert.equal(readLabelVersion(store, { version: "fixture-label-1" }).deadZone, "0.01");

  assert.equal(registerLabelVersion(store, definition("fixture-label-3", { deadZone: "" })).error, "dead zone is not configured");
  assert.equal(registerLabelVersion(store, definition("fixture-label-3", {
    observationWindow: undefined,
  })).error, "observation window is not configured");
  assert.equal(registerLabelVersion(store, definition("fixture-label-3", {
    horizons: ["1m"],
  })).error, "horizon is not configured");
  assert.equal(labelOutcome(store, sample({ version: "missing" })).error, "label version is not configured");

  assert.equal(LABEL_TARGET_RETURN, "future mid-price return");
  assert.deepEqual(Object.keys(labels).sort(), [
    "LABEL_TARGET_RETURN",
    "SPOT_HORIZONS",
    "createLabelStore",
    "labelOutcome",
    "readLabelVersion",
    "registerLabelVersion",
  ]);
  assert.equal("placeOrder" in labels, false);
  const source = readFileSync(new URL("../services/label-definitions.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("S_spot"), false);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
