import assert from "node:assert/strict";
import test from "node:test";
import {
  BINANCE_FUTURES_FIELDS,
  BINANCE_INTELLIGENCE,
  BINANCE_SPOT_FIELDS,
  CEX_VENUES,
} from "../services/cex-catalog.mjs";

test("Binance and Bybit are the only live centralized books", () => {
  assert.equal(CEX_VENUES.length, 15);
  const binance = CEX_VENUES[0];
  const bybit = CEX_VENUES[1];
  assert.equal(binance.id, "binance");
  assert.equal(bybit.id, "bybit");
  assert.equal(bybit.spot.state, "live");
  assert.equal(bybit.futures.state, "live");
  assert.equal(bybit.spot.feed, "bybit-spot");
  assert.equal(bybit.futures.feed, "bybit-linear");
  assert.ok(bybit.spot.uses.every((place) => place.startsWith("Admin · Bybit")));
  assert.equal(bybit.spot.uses.some((place) => place.includes("Binance")), false);
  assert.equal(binance.spot.uses.some((place) => place.includes("Bybit")), false);
  assert.equal(binance.id, "binance");
  assert.equal(binance.spot.state, "live");
  assert.equal(binance.futures.state, "live");
  assert.equal(binance.spot.feed, "binance-spot");
  assert.equal(binance.v3, undefined);
  assert.ok(binance.spot.uses.some((place) => place.includes("Spot API v3")));
  assert.equal(binance.futures.uses.some((place) => place.includes("Spot API v3")), false);
  assert.ok(binance.spot.uses.every((place) => place.startsWith("Market ·")));
  assert.ok(binance.futures.uses.some((place) => place.includes("funding")));
  assert.equal(binance.spot.uses.some((place) => place.includes("funding")), false);
  const others = CEX_VENUES.slice(2);
  assert.ok(others.every((venue) => venue.spot.state !== "live" && venue.spot.uses.length === 0));
  assert.ok(others.every((venue) => venue.futures.state !== "live"));
  assert.equal(CEX_VENUES.find((venue) => venue.id === "coinbase").futures.state, "absent");
  assert.equal(BINANCE_INTELLIGENCE.products.length, 3);
  assert.ok(BINANCE_INTELLIGENCE.products.every((product) => product.state === "error" && product.uses.length === 0));
  assert.ok(BINANCE_SPOT_FIELDS.some((field) => field.wasHidden && field.field === "t"));
  assert.ok(BINANCE_FUTURES_FIELDS.some((field) => field.wasHidden && field.field === "ap"));
});
