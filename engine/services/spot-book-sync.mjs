// Spot diff-depth gap detection for TASK 07.B.02.
// TASK 08.B.01 applies the same official local-book steps.
// Buffer events and keep the U of the first event.
// A snapshot whose lastUpdateId is strictly less than that U is too old.
// Discard buffered events whose final id is less than or equal to the snapshot id.
// The first remaining event must contain the snapshot id.
// An event whose final id is below the local update id is ignored.
// A final id equal to the local update id stays a duplicate, as decision 0029 requires.
// Discard the book when a later event U is greater than the local update id plus 1.
// A depth payload that fails that documented shape discards the book.
// A missed pong minute or a 24-hour connection marks the stream stale.
// Event time after receive time is clock skew. The feed names no skew allowance.
// This module does not open a socket and does not place an order.

import {
  SPOT_STREAM_LIFECYCLE,
  SPOT_STREAM_ORIGIN,
  publicMarketUrl,
} from "./binance-spot-public.mjs";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SYMBOL = /^[A-Z0-9]+$/;
const ZERO = /^0(?:\.0+)?$/;

function fail(error) {
  return { ok: false, healthy: false, blocked: "BLOCKED", error, reason: error, action: null, book: null };
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decimal(value) {
  return typeof value === "string" && DECIMAL.test(value);
}

function symbol(value) {
  return typeof value === "string" && SYMBOL.test(value);
}

function levels(rows) {
  if (!Array.isArray(rows)) return null;
  const book = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2 || !decimal(row[0]) || !decimal(row[1])) return null;
    if (ZERO.test(row[1])) book.delete(row[0]);
    else book.set(row[0], row[1]);
  }
  return book;
}

function parseDepth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.e !== "depthUpdate") return null;
  if (!whole(value.E) || !symbol(value.s) || !whole(value.U) || !whole(value.u) || value.U > value.u) {
    return null;
  }
  const bids = levels(value.b);
  const asks = levels(value.a);
  if (!bids || !asks) return null;
  return { E: value.E, s: value.s, U: value.U, u: value.u, bids, asks };
}

function parseSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !whole(value.lastUpdateId)) return null;
  const bids = levels(value.bids);
  const asks = levels(value.asks);
  if (!bids || !asks) return null;
  return { lastUpdateId: value.lastUpdateId, bids, asks };
}

function skewed(event, receiveTime) {
  return !whole(receiveTime) || receiveTime < event.E;
}

function publish(book) {
  return {
    updateId: book.updateId,
    validityTimestamp: book.validityTimestamp,
    bids: [...book.bids].map(([price, quantity]) => [price, quantity]),
    asks: [...book.asks].map(([price, quantity]) => [price, quantity]),
  };
}

function latchStale(state, at) {
  if (!whole(at) || state.connectedAt == null) {
    state.stale = true;
    return;
  }
  if (at - state.connectedAt >= SPOT_STREAM_LIFECYCLE.connectionValidMs) state.stale = true;
  if (state.pendingPingAt != null && at - state.pendingPingAt >= SPOT_STREAM_LIFECYCLE.pongDeadlineMs) {
    state.stale = true;
  }
}

function report(state, at) {
  latchStale(state, at);
  const intervals = state.intervals.map((item) => ({ ...item }));
  let reason = state.lastReason;
  let action = state.lastAction;
  let healthy = false;
  if (state.stale) {
    reason = "stale stream";
    action = "reconnect";
  } else if (state.reconnected || state.book == null) {
    reason = state.lastReason;
    action = state.lastAction;
  } else if (state.skewed) {
    reason = "clock skew";
    action = null;
  } else if (state.duplicate) {
    reason = "duplicate";
    action = null;
  } else if (state.intervals.some((item) => item.healed !== true)) {
    reason = "sequence gap";
    action = "resnapshot";
  } else {
    healthy = true;
    reason = null;
    action = null;
  }
  return {
    ok: true,
    healthy,
    blocked: healthy ? null : "BLOCKED",
    reason,
    action,
    book: healthy ? publish(state.book) : null,
    intervals,
  };
}

function applyLevels(book, event) {
  for (const [price, quantity] of event.bids) {
    if (ZERO.test(quantity)) book.bids.delete(price);
    else book.bids.set(price, quantity);
  }
  for (const [price, quantity] of event.asks) {
    if (ZERO.test(quantity)) book.asks.delete(price);
    else book.asks.set(price, quantity);
  }
  book.updateId = event.u;
  book.validityTimestamp = event.E;
}

export function spotDepthResyncTargets(value) {
  const snapshot = publicMarketUrl("/api/v3/depth", { symbol: value, limit: 5000 });
  if (!snapshot.ok) return { ...snapshot, healthy: false };
  return {
    ok: true,
    healthy: false,
    blocked: "BLOCKED",
    method: snapshot.method,
    snapshotUrl: snapshot.url,
    streamUrl: `${SPOT_STREAM_ORIGIN}/ws/${value.toLowerCase()}@depth`,
  };
}

export function createSpotBookSync(value) {
  if (!symbol(value)) return fail("symbol is not allowed");
  const state = {
    symbol: value,
    connectedAt: null,
    pendingPingAt: null,
    stale: false,
    reconnected: false,
    buffer: [],
    firstU: null,
    book: null,
    skewed: false,
    duplicate: false,
    intervals: [],
    lastReason: "snapshot is required",
    lastAction: "resnapshot",
  };

  function rememberClock(event, receiveTime) {
    if (!skewed(event, receiveTime)) {
      state.skewed = false;
      for (const item of state.intervals) {
        if (item.fault === "clock skew") item.healed = true;
      }
      return;
    }
    state.skewed = true;
    state.intervals.push({
      fault: "clock skew",
      eventTime: event.E,
      receiveTime: whole(receiveTime) ? receiveTime : null,
      healed: false,
    });
    state.lastReason = "clock skew";
    state.lastAction = null;
  }

  return {
    noteConnected(at) {
      if (state.stale || state.reconnected) return report(state, at);
      if (!whole(at)) return fail("clock is required");
      state.connectedAt = at;
      state.pendingPingAt = null;
      return report(state, at);
    },
    notePing(at) {
      if (!whole(at)) return fail("clock is required");
      state.pendingPingAt = at;
      return report(state, at);
    },
    notePong(at) {
      state.pendingPingAt = null;
      return report(state, whole(at) ? at : state.connectedAt);
    },
    noteReconnect(at) {
      if (!whole(at)) return fail("clock is required");
      state.stale = false;
      state.reconnected = true;
      state.book = null;
      state.buffer = [];
      state.firstU = null;
      state.skewed = false;
      state.duplicate = false;
      state.connectedAt = at;
      state.pendingPingAt = null;
      state.lastReason = "reconnect";
      state.lastAction = "resnapshot";
      return report(state, at);
    },
    ingestDepth(raw, receiveTime) {
      const event = parseDepth(raw);
      if (!event || event.s !== state.symbol) {
        state.book = null;
        state.buffer = [];
        state.firstU = null;
        state.reconnected = false;
        state.skewed = false;
        state.duplicate = false;
        state.lastReason = "depth schema is not allowed";
        state.lastAction = "resnapshot";
        return fail("depth schema is not allowed");
      }
      if (state.book == null) {
        state.buffer.push({ event, receiveTime });
        if (state.firstU == null) state.firstU = event.U;
        if (!state.reconnected) {
          state.lastReason = "snapshot is required";
          state.lastAction = "resnapshot";
        }
        return report(state, state.connectedAt);
      }
      if (event.u < state.book.updateId) {
        return report(state, state.connectedAt);
      }
      if (event.u === state.book.updateId) {
        state.duplicate = true;
        state.lastReason = "duplicate";
        state.lastAction = null;
        return report(state, state.connectedAt);
      }
      if (event.U > state.book.updateId + 1) {
        state.intervals.push({
          fault: "sequence gap",
          fromUpdateId: state.book.updateId + 1,
          toUpdateId: event.U - 1,
          healed: false,
        });
        state.book = null;
        state.buffer = [{ event, receiveTime }];
        state.firstU = event.U;
        state.duplicate = false;
        state.lastReason = "sequence gap";
        state.lastAction = "resnapshot";
        return report(state, state.connectedAt);
      }
      applyLevels(state.book, event);
      state.duplicate = false;
      rememberClock(event, receiveTime);
      return report(state, state.connectedAt);
    },
    ingestSnapshot(raw) {
      const snapshot = parseSnapshot(raw);
      if (!snapshot) return fail("depth schema is not allowed");
      if (state.firstU == null) return report(state, state.connectedAt);
      if (snapshot.lastUpdateId < state.firstU) {
        state.lastReason = "snapshot is required";
        state.lastAction = "resnapshot";
        return report(state, state.connectedAt);
      }
      const kept = state.buffer.filter((item) => item.event.u > snapshot.lastUpdateId);
      const first = kept[0];
      if (!first || snapshot.lastUpdateId < first.event.U || snapshot.lastUpdateId > first.event.u) {
        state.book = null;
        state.buffer = kept;
        state.firstU = first ? first.event.U : null;
        state.lastReason = "snapshot is required";
        state.lastAction = "resnapshot";
        return report(state, state.connectedAt);
      }
      state.book = {
        updateId: snapshot.lastUpdateId,
        validityTimestamp: null,
        bids: snapshot.bids,
        asks: snapshot.asks,
      };
      state.buffer = [];
      state.firstU = null;
      state.reconnected = false;
      state.duplicate = false;
      state.skewed = false;
      for (const item of kept) {
        if (item.event.u <= state.book.updateId) continue;
        if (item.event.U > state.book.updateId + 1) {
          state.intervals.push({
            fault: "sequence gap",
            fromUpdateId: state.book.updateId + 1,
            toUpdateId: item.event.U - 1,
            healed: false,
          });
          state.book = null;
          state.buffer = [item];
          state.firstU = item.event.U;
          state.lastReason = "sequence gap";
          state.lastAction = "resnapshot";
          return report(state, state.connectedAt);
        }
        applyLevels(state.book, item.event);
        rememberClock(item.event, item.receiveTime);
      }
      if (!state.skewed) {
        for (const item of state.intervals) {
          if (item.fault === "sequence gap") item.healed = true;
        }
        state.lastReason = null;
        state.lastAction = null;
      }
      return report(state, state.connectedAt);
    },
    status(at) {
      return report(state, at);
    },
  };
}
