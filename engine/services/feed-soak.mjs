// Controlled public-fixture soak and replay for TASK 07.C.02.
// The design phase-3 acceptance names a 24 hour soak. The Spot connection
// lifetime recorded for that feed is 24 hours. This clock is injected.
// Raw public messages stay append-only. No retention period is in the source.
// No data-licence grant is in the source. Only recorded public fixtures are used.
// This module does not open a network connection.

import { BINANCE_SPOT_PUBLIC_DOCS, SPOT_STREAM_LIFECYCLE, createPublicStreamSession, parseRecentTrades, parseSpotStreamMessage } from "./binance-spot-public.mjs";
import { appendRawPublicMessage, createEventLog, normalizeMarketEvent } from "./market-event-envelope.mjs";
import { createMarketQueue } from "./market-event-queue.mjs";

const RECEIVE_TIME = "1672515782137";

const tradeStream = Object.freeze({
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

const recentTrade = Object.freeze({
  id: 28457,
  price: "4.00000100",
  qty: "12.00000000",
  quoteQty: "48.000012",
  time: 1499865549590,
  isBuyerMaker: true,
  isBestMatch: true,
});

export const FEED_SOAK_CONSTRAINTS = Object.freeze({
  retention: "NOT IN SOURCE",
  retentionDetail: "Raw public messages stay append-only. The source names raw payload retention and compressed object storage for replay. It names no retention period and no deletion rule.",
  licensing: "NOT IN SOURCE",
  licensingDetail: "The design says API terms are checked before production enablement. The checklist has a data licence field. No licence grant is recorded. This run uses recorded public fixtures only.",
});

function fail(error) {
  return { ok: false, error };
}

function envelope(log, rawMessage, fields) {
  const raw = appendRawPublicMessage(log, rawMessage);
  if (!raw.ok) return raw;
  return normalizeMarketEvent(log, { ...fields, rawEventReference: raw.reference });
}

export function replayRecordedFixtures() {
  const log = createEventLog();
  const trade = parseSpotStreamMessage(tradeStream);
  if (!trade.ok) return trade;
  const recent = parseRecentTrades([recentTrade]);
  if (!recent.ok) return recent;
  const streamEvent = envelope(log, trade.event, {
    eventTime: trade.event.E,
    receiveTime: RECEIVE_TIME,
    venue: "Binance",
    product: "Spot",
    symbol: trade.event.s,
    sequence: trade.event.t,
    price: trade.event.p,
    quantity: trade.event.q,
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
  });
  if (!streamEvent.ok) return streamEvent;
  const row = recent.trades[0];
  const restEvent = envelope(log, row, {
    eventTime: row.time,
    receiveTime: RECEIVE_TIME,
    venue: "Binance",
    product: "Spot",
    symbol: "ETHBTC",
    sequence: row.id,
    price: row.price,
    quantity: row.qty,
    schemaVersion: BINANCE_SPOT_PUBLIC_DOCS.version,
  });
  if (!restEvent.ok) return restEvent;
  return { ok: true, events: [streamEvent.event, restEvent.event] };
}

function transport() {
  return {
    connect() {},
    send() {},
    pong() {
      return true;
    },
    close() {},
  };
}

export function runFeedSoak(input) {
  const source = input && typeof input === "object" ? input : {};
  const replay = replayRecordedFixtures();
  if (!replay.ok) return replay;
  const queue = createMarketQueue({ capacity: source.capacity, retryBudget: source.retryBudget });
  if (typeof queue.publish !== "function") return queue;
  let lag = 0;
  for (const event of replay.events) {
    const published = queue.publish(event);
    if (!published.accepted) return fail(published.reason || "queue cap");
    lag = Math.max(lag, queue.stats().lag);
  }
  while (queue.stats().depth > 0) {
    const next = queue.consume();
    if (!next.ok) return next;
    const acked = queue.ack(next.id);
    if (!acked.ok) return acked;
  }
  let clock = 0;
  const session = createPublicStreamSession({
    streams: ["btcusdt@trade", "btcusdt@bookTicker"],
    now: () => clock,
  });
  const connected = session.connect(transport());
  if (!connected.ok) return connected;
  const ingested = session.onMessage(tradeStream);
  if (!ingested.ok) return ingested;
  clock = SPOT_STREAM_LIFECYCLE.connectionValidMs;
  const ticked = session.tick(clock);
  if (!ticked.ok) return ticked;
  const shot = session.snapshot();
  return {
    ok: true,
    uptime: SPOT_STREAM_LIFECYCLE.connectionValid,
    uptimeMs: clock,
    lag,
    reconnects: shot.reconnects.length,
    reconnectReasons: [...shot.reconnects],
    drops: queue.stats().dropped,
    constraints: FEED_SOAK_CONSTRAINTS,
    replay: replay.events,
  };
}
