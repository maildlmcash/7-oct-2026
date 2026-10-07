# 0031 — Feed soak and replay parity

Status: accepted for the controlled public-fixture soak.

## Context

TASK 07.C.02 asks for a controlled soak, deterministic replay of recorded public fixtures, and a record of retention and data-licensing constraints. The soak report must include uptime, lag, reconnects, and drops. Replay must produce the expected normalized output.

Design phase 3 names a 24 hour soak. The Spot connection lifetime already recorded for this feed is 24 hours. Design phase 2 names raw payload retention and says a sample payload is normalized and replayed. The source names no retention period and no deletion rule. Raw public messages stay append-only. The design says API terms are checked before production enablement, and the checklist has a data licence field. No licence grant is recorded. Decision 0028 normalizes the public envelope. Decision 0030 bounds the queue. The recent-trade example row has no symbol. The exchangeInfo example symbol `ETHBTC` is supplied on that envelope and is not a claim that trade id `28457` belongs to that market.

## Decision

`services/feed-soak.mjs` replays the recorded Spot trade stream and the recorded recent-trade row through the existing parser and envelope. Two runs return the same normalized events. The soak publishes those events into a caller-capped queue, records the peak consumer lag, then acks them. `dropped` stays 0. An injected clock runs to the 24 hour connection mark and records one reconnect reason, `24 hours`. The report states retention and licensing as `NOT IN SOURCE` with the constraints above. No network connection is opened. No object store is added. The receive time `1672515782137` is caller-supplied because the public trade message has no receive timestamp. Decision 0032 keeps the trader input in the contracts package.

## Evidence

`pnpm test:feed-soak` checks uptime `24 hours`, peak lag 2, one reconnect, drops 0, and replay parity for prices `0.001` and `4.00000100`.
