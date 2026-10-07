import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { BINANCE_SPOT_PUBLIC_DOCS } from "../services/binance-spot-public.mjs";
import {
  appendRawPublicMessage,
  createEventLog,
  normalizeMarketEvent,
  readMarketEvents,
  readRawPublicMessage,
} from "../services/market-event-envelope.mjs";

const tradeStream = {
  e: "trade",
  E: 1672515782136,
  s: "BNBBTC",
  t: 12345,
  p: "0.001",
  q: "100",
  T: 1672515782136,
  m: true,
  M: true,
};

const recentTrade = {
  id: 28457,
  price: "4.00000100",
  qty: "12.00000000",
  quoteQty: "48.000012",
  time: 1499865549590,
  isBuyerMaker: true,
  isBestMatch: true,
};

// Caller-supplied receive time. The public trade message has no receive timestamp.
const receiveTime = "1672515782137";

test("round trip keeps decimal strings, source times, sequence, and raw reference", () => {
  const log = createEventLog();
  const rawTrade = appendRawPublicMessage(log, tradeStream);
  const rawRecent = appendRawPublicMessage(log, recentTrade);
  tradeStream.p = "9";
  assert.equal(rawTrade.message.p, "0.001");
  assert.throws(() => {
    rawTrade.message.p = "8";
  });
  assert.equal(rawTrade.message.p, "0.001");

  const streamEvent = normalizeMarketEvent(log, {
    eventTime: tradeStream.E,
    receiveTime,
    venue: "Binance",
    product: "Spot",
    symbol: tradeStream.s,
    sequence: tradeStream.t,
    price: rawTrade.message.p,
    quantity: rawTrade.message.q,
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
    rawEventReference: rawTrade.reference,
  });
  const recentEvent = normalizeMarketEvent(log, {
    eventTime: recentTrade.time,
    receiveTime,
    venue: "Binance",
    product: "Spot",
    symbol: "ETHBTC",
    sequence: recentTrade.id,
    price: recentTrade.price,
    quantity: recentTrade.qty,
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
    rawEventReference: rawRecent.reference,
  });
  const wideSequence = normalizeMarketEvent(log, {
    eventTime: tradeStream.E,
    receiveTime,
    venue: "Binance",
    product: "Spot",
    symbol: tradeStream.s,
    sequence: "9007199254740993",
    price: "0.001",
    quantity: "100",
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
    rawEventReference: rawTrade.reference,
  });

  const events = readMarketEvents(log).events;
  assert.equal(events.length, 3);
  assert.equal(events[0], streamEvent.event);
  assert.equal(events[0].eventTime, 1672515782136);
  assert.equal(events[0].receiveTime, "1672515782137");
  assert.equal(typeof events[0].receiveTime, "string");
  assert.equal(events[0].venue, "Binance");
  assert.equal(events[0].product, "Spot");
  assert.equal(events[0].symbol, "BNBBTC");
  assert.equal(events[0].sequence, 12345);
  assert.equal(events[0].price, "0.001");
  assert.equal(events[0].quantity, "100");
  assert.equal(events[0].schemaVersion, "2026-09-18");
  assert.equal(events[0].rawEventReference, "raw-1");
  assert.deepEqual(readRawPublicMessage(log, events[0].rawEventReference).message, {
    e: "trade",
    E: 1672515782136,
    s: "BNBBTC",
    t: 12345,
    p: "0.001",
    q: "100",
    T: 1672515782136,
    m: true,
    M: true,
  });

  assert.equal(events[1], recentEvent.event);
  assert.equal(events[1].price, "4.00000100");
  assert.equal(events[1].quantity, "12.00000000");
  assert.notEqual(events[1].price, "4.000001");
  assert.equal(events[1].eventTime, 1499865549590);
  assert.equal(events[1].sequence, 28457);
  assert.equal(events[1].rawEventReference, "raw-2");
  assert.equal(readRawPublicMessage(log, "raw-2").message.price, "4.00000100");
  assert.equal(readRawPublicMessage(log, "raw-2").message.qty, "12.00000000");
  assert.equal(events[2].sequence, "9007199254740993");
  assert.equal(typeof events[2].sequence, "string");
  assert.equal(wideSequence.event.sequence, events[2].sequence);

  const before = log.events.length;
  const numeric = normalizeMarketEvent(log, {
    eventTime: tradeStream.E,
    receiveTime,
    venue: "Binance",
    product: "Spot",
    symbol: "BNBBTC",
    sequence: 12345,
    price: 0.001,
    quantity: "100",
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
    rawEventReference: rawTrade.reference,
  });
  assert.equal(numeric.blocked, "BLOCKED");
  assert.equal(numeric.error, "price is required");
  assert.equal(Object.hasOwn(numeric, "event"), false);
  assert.equal(log.events.length, before);
  assert.equal(log.raw.length, 2);

  const missingRaw = normalizeMarketEvent(log, {
    eventTime: tradeStream.E,
    receiveTime,
    venue: "Binance",
    product: "Spot",
    symbol: "BNBBTC",
    sequence: 12345,
    price: "0.001",
    quantity: "100",
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
    rawEventReference: "raw-9",
  });
  assert.equal(missingRaw.error, "raw event reference is required");
  assert.equal(log.events.length, before);
  assert.equal(log.raw.length, 2);
  assert.equal(health.liveTrading, "OFF");
  assert.equal(health.liveOrdersLocked, true);
});
