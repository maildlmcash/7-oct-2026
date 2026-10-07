# 0030 — Bounded market-event queue

Status: accepted for the in-process bounded queue.

## Context

TASK 07.C.01 asks for the approved event backbone, bounded queues, consumer lag, a retry budget, and dead-letter handling. Market events must not be dropped silently. Overload must be visible, and downstream quality must be marked degraded.

Design section 18 names NATS JetStream as the lightweight event bus. Kafka and Redpanda wait until replay or throughput requires them. Redis is a bounded cache and is not the source of truth. Queues are bounded and backpressure-enabled. A cap breach applies backpressure, degrades, and alerts. The same section names finite timeouts, a retry budget, a queue cap, and resource limits, and it names no numbers for them. No NATS server, NATS client, or container runtime is installed in this workspace.

## Decision

`services/market-event-queue.mjs` is the in-process queue for that backbone. Its recorded backbone name is `NATS JetStream`. It does not open a broker. The caller supplies the queue cap and the retry budget. Missing numbers fail closed. Publish stores a clone until the cap is reached. A further publish returns the event, increments the refused count, and does not remove a stored event. `dropped` stays 0. Consumer lag is queued depth plus in-flight depth. A failed delivery stays queued until the retry budget is spent, then moves to the dead letter and remains readable. A full queue or a dead letter sets quality `degraded` and blocked `BLOCKED`. An ack removes only an in-flight event after a successful consume. No timeout duration is stored. Decision 0031 replays recorded public fixtures through this queue under an injected clock.

## Evidence

`pnpm test:market-event-queue` publishes 10000 fixture events into a caller cap of 8. Retained slots stay at 8, refused events are returned, dropped stays 0, and quality is degraded. A second case spends a caller retry budget of 2, keeps the dead-letter event, and refuses the next publish without removing it.
