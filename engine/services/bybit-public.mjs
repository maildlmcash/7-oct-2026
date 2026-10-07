const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const TOPIC = "orderbook.1.BTCUSDT";

export const BYBIT_LIMITS = Object.freeze({
  docsUrl: "https://bybit-exchange.github.io/docs/v5/ws/connect",
  checkedAt: "2026-10-07",
  ping: "Send {\"op\":\"ping\"} every 20 seconds.",
  connectionAttempts: "At most 500 connections in 5 minutes on one WebSocket domain.",
  argsLimit: "Subscribed topic text on one connection stays under 21,000 characters.",
  privateStream: "wss://stream.bybit.com/v5/private is not opened. It needs an API key.",
});

function bookSpec(kind, origin) {
  return Object.freeze({
    kind,
    origin,
    topic: TOPIC,
    symbol: "BTCUSDT",
    conditions: Object.freeze([
      `Public ${kind} host only. No API key and no order route.`,
      `The only topic is ${TOPIC}. Level 1 is a snapshot, not a delta.`,
      BYBIT_LIMITS.ping,
      BYBIT_LIMITS.connectionAttempts,
      BYBIT_LIMITS.argsLimit,
      "An invalid frame is ignored. It is never stored as zero.",
      BYBIT_LIMITS.privateStream,
    ]),
    fields: Object.freeze([
      Object.freeze({ field: "topic", meaning: "Subscribed topic", limit: TOPIC, used: `Admin · Bybit ${kind} top of book` }),
      Object.freeze({ field: "b[0]", meaning: "Best bid price and size", limit: "Decimal strings", used: `Admin · Bybit ${kind} bid` }),
      Object.freeze({ field: "a[0]", meaning: "Best ask price and size", limit: "Decimal strings", used: `Admin · Bybit ${kind} ask` }),
      Object.freeze({ field: "u", meaning: "Update id", limit: "Whole number, in sequence", used: `Admin · Bybit ${kind} update id` }),
      Object.freeze({ field: "type", meaning: "Snapshot or delta", limit: "Level 1 must be snapshot", used: `Admin · Bybit ${kind} parser gate` }),
    ]),
  });
}

export const BYBIT_SPOT = bookSpec("spot", "wss://stream.bybit.com/v5/public/spot");
export const BYBIT_LINEAR = bookSpec("linear", "wss://stream.bybit.com/v5/public/linear");

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

export function parseBybitBook(input) {
  if (!input || typeof input !== "object") return null;
  if (input.topic !== TOPIC || input.type !== "snapshot") return null;
  const data = input.data;
  if (!data || data.s !== "BTCUSDT" || !Array.isArray(data.b) || !Array.isArray(data.a)) return null;
  const bid = data.b[0];
  const ask = data.a[0];
  if (!Array.isArray(bid) || !Array.isArray(ask)) return null;
  if (!decimal(bid[0]) || !decimal(bid[1]) || !decimal(ask[0]) || !decimal(ask[1])) return null;
  if (!Number.isInteger(data.u) || data.u < 0) return null;
  return {
    symbol: "BTCUSDT",
    bid: bid[0],
    bidQty: bid[1],
    ask: ask[0],
    askQty: ask[1],
    updateId: data.u,
  };
}
