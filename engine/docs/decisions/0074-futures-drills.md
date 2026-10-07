# 0074 — Futures failure drills

Status: accepted for paper failure drills. Each drill alerts and disables new simulated risk until the feed and the paper position both reconcile. Live orders stay locked.

## Context

TASK 15.C.01 asks to inject a missing mark price, a funding outage, a stream gap, a worker restart, and an order timeout, and to verify fail-safe behavior and alerting. Every scenario must disable new simulated risk until data and state reconcile.

Design page 2 says a stale price blocks a new automatic entry and preserves reduce-only separately. Design page 8 says a timeout is unknown pending reconciliation and is never a blind retry. Design page 9 names stale mark, stale funding, and sequence gap as feed faults. It does not name a timeout duration or a worker-memory store. Decision 0056 suppresses a futures score on those feed faults and does not place an order. Decision 0068 records that a clock does not append timeout and that a restart does not restore the paper log. Decision 0071 vetoes a stale mark on a new entry and vetoes a funding fault on every order. Decision 0073 stops liquidation and reduce-only cases and does not inject these drills.

## Decision

`services/futures-drills.mjs` exports `createFuturesDrillStore`, `injectFuturesDrill`, `reconcileFuturesDrill`, `attemptFuturesDrillOrder`, `readFuturesDrill`, `FUTURES_DRILL_SCENARIOS`, and `FUTURES_DRILL_LIMITATIONS`.

A missing mark is a blank mark value. The drill alerts `missing mark price` with state `abstain` and does not call for a score. A funding outage is the existing stale-funding alert with reason `outage`. A stream gap is a sequence more than one ahead of its watermark, or quality reason `sequence gap`. The reason is `sequence gap` and the state is `abstain`. A worker restart alerts `worker restart`, leaves `restored` false, and does not delete the paper position. An order timeout alerts `order timeout` with status `unknown pending reconciliation`. `timeoutApplied` stays false and `retried` stays false. A clock is not an input. The same order id is not submitted again.

Each drill starts with `newRiskEnabled` false. A risk-increasing order appends nothing while that flag is false. A missing mark or a stream gap still allows a reduce-only close, and that close clears state reconciliation. A funding outage, a restart, and a timeout do not. Data reconciliation requires a feed that no longer has the injected fault and that `evaluateFuturesFaults` does not suppress. State reconciliation requires the caller position quantity to match the paper position exactly. Either side alone leaves new risk disabled. A mismatched quantity stays visible. The same idempotency key and body replay the injection and do not add a second alert.

A Spot order is `product is not supported` and is not stored. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true. No PostgreSQL table was added. `futures-faults.mjs`, `futures-pretrade.mjs`, `futures-paper.mjs`, and `paper-faults.mjs` were not changed.

## Evidence

`pnpm test:futures-drills` passed 3/3, duration_ms 513.106809. A long of quantity `2` with a blank mark stays quantity `2` when a new long is attempted. The alert is `missing mark price`, state `abstain`, and `newRiskEnabled` is false. Replaying the drill leaves one alert. A reduce-only close of quantity `1` at `110` returns PnL `10` and leaves quantity `1`, with the alert still set. Stated quantity `2` is `position quantity does not match`. A healthy feed alone is `state is not reconciled`. Stated quantity `1` then reconciles. A later long of quantity `1` at `100` leaves quantity `2`.

A funding quality reason `outage` alerts `funding outage` with reason `outage`. A new long and a reduce-only close both stay quantity `2` and leave one order. Stated quantity `3` stays visible. After a healthy feed and stated quantity `2`, a new long leaves quantity `3`. A mark sequence `10` after watermark `8` alerts `stream gap` with reason `sequence gap`. The same gap does not reconcile the data. A healthy feed and stated quantity `2` then allow a new long to quantity `3`. A consecutive sequence is `stream gap is not present` and stores nothing.

A worker restart on a healthy feed still disables new risk, leaves `restored` false, and leaves one order. State alone is `data is not reconciled`. A healthy feed then reconciles, and `restored` stays false. A new long leaves quantity `3`. An order timeout on `fixture-open` is `unknown pending reconciliation`. A clock field is `unsupported field` and stores nothing. The same order id does not append before or after reconciliation. A different order id after reconciliation leaves quantity `3`. A Spot object `fixture-spot-order` is `product is not supported` and is not stored. `bearer fixture-token` is not echoed. Price `100.2` is `price is not on the tick` and is not echoed. A Customer writes no drill. The module calls `evaluateFuturesFaults` and does not call the pre-trade gate or a venue client. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Lag `1000` and funding interval `8` are fixtures and are NOT IN SOURCE. Decision 0075 records the live-futures lock and does not change these drills.
