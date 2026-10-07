// Bounded market-event queue for TASK 07.C.01.
// Design section 18 names NATS JetStream as the lightweight event bus.
// Queues stay bounded and backpressure-enabled. Cache is not the source of truth.
// The source names no queue cap, retry budget, or timeout, so those values are caller-supplied.
// A full queue returns the event. It does not drop a stored market event.
// This module does not open a broker connection.

const BACKBONE = "NATS JetStream";

function fail(error) {
  return { ok: false, accepted: false, dropped: false, degraded: true, quality: "degraded", blocked: "BLOCKED", error };
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function createMarketQueue(input) {
  const source = input && typeof input === "object" ? input : {};
  if (!whole(source.capacity)) return fail("queue cap is required");
  if (!whole(source.retryBudget)) return fail("retry budget is required");
  const capacity = source.capacity;
  const retryBudget = source.retryBudget;
  const slots = [];
  let nextId = 1;
  let refused = 0;
  let overloaded = false;

  function counts() {
    let depth = 0;
    let inflight = 0;
    let deadLetters = 0;
    for (const row of slots) {
      if (row.state === "queued") depth += 1;
      else if (row.state === "inflight") inflight += 1;
      else if (row.state === "dead") deadLetters += 1;
    }
    const degraded = overloaded || deadLetters > 0;
    return {
      backbone: BACKBONE,
      capacity,
      retryBudget,
      depth,
      inflight,
      lag: depth + inflight,
      deadLetters,
      retained: slots.length,
      refused,
      dropped: 0,
      overloaded,
      quality: degraded ? "degraded" : null,
      blocked: degraded ? "BLOCKED" : null,
    };
  }

  function rowById(id, state) {
    return slots.find((row) => row.id === id && row.state === state);
  }

  return {
    publish(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        return { ...fail("market event is required"), event: event ?? null };
      }
      const current = counts();
      if (slots.length >= capacity) {
        refused += 1;
        overloaded = true;
        return {
          ok: false,
          accepted: false,
          dropped: false,
          degraded: true,
          quality: "degraded",
          blocked: "BLOCKED",
          reason: "queue cap",
          event,
          retained: slots.length,
          refused,
        };
      }
      const row = {
        id: nextId,
        attempts: 0,
        state: "queued",
        event: structuredClone(event),
      };
      nextId += 1;
      slots.push(row);
      const after = counts();
      return {
        ok: true,
        accepted: true,
        dropped: false,
        degraded: after.quality === "degraded",
        quality: after.quality,
        blocked: after.blocked,
        id: row.id,
        event: row.event,
        retained: current.retained + 1,
      };
    },
    consume() {
      const row = slots.find((item) => item.state === "queued");
      if (!row) return { ok: false, dropped: false, error: "queue is empty", event: null };
      row.state = "inflight";
      return { ok: true, dropped: false, id: row.id, attempts: row.attempts, event: row.event };
    },
    fail(id) {
      const row = rowById(id, "inflight");
      if (!row) return fail("inflight event is required");
      row.attempts += 1;
      if (row.attempts >= retryBudget) {
        row.state = "dead";
        return {
          ok: true,
          dropped: false,
          dead: true,
          attempts: row.attempts,
          quality: "degraded",
          blocked: "BLOCKED",
          event: row.event,
        };
      }
      row.state = "queued";
      return {
        ok: true,
        dropped: false,
        dead: false,
        attempts: row.attempts,
        event: row.event,
      };
    },
    ack(id) {
      const index = slots.findIndex((row) => row.id === id && row.state === "inflight");
      if (index < 0) return fail("inflight event is required");
      const row = slots[index];
      slots.splice(index, 1);
      return { ok: true, acked: true, dropped: false, event: row.event };
    },
    deadLetters() {
      return slots
        .filter((row) => row.state === "dead")
        .map((row) => ({ id: row.id, attempts: row.attempts, event: row.event }));
    },
    stats() {
      return counts();
    },
  };
}
