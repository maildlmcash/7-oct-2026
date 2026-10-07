# 0068 — Paper fault injection

Status: accepted for paper-only fault injection. A repeated submission does not create a second order. The kill switch blocks a new paper decision and does not close an existing paper order. Live orders stay locked.

## Context

TASK 14.C.01 asks to test duplicate submission, timeout, cancel/fill race, restart, stale balance, and kill-switch behavior in paper mode. No duplicate position or order may appear. The kill switch prevents new paper decisions and closes only according to documented simulation rules.

Design page 9 names HALT KILL_SWITCH as blocking new orders, and it also names cancel, reconcile, and an operator alert. Decision 0065 records that the paper gate blocks the new paper create and does not cancel, reconcile, or alert. Decision 0064 records the paper states and says the timeout duration and balance reconciliation are NOT IN SOURCE. Decision 0067 estimates a passive queue and does not inject a fault.

## Decision

`services/paper-faults.mjs` exports `PAPER_FAULTS`, `PAPER_FAULT_LIMITATIONS`, and `injectPaperFault`.

The six faults are `duplicate submission`, `timeout`, `cancel/fill race`, `restart`, `stale balance`, and `kill switch`. Each fault accepts only its own keys. Another key is `unsupported field`.

A duplicate submission appends the same paper request twice through `appendPaperOrder`. The second append is the stored event. The order count and the event count do not grow. No position is stored. `position` stays null on every report.

A caller clock does not append `timeout`. The timeout duration is NOT IN SOURCE. `timeoutApplied` stays false. A missing clock is `clock is not configured`. A clock that is not a non-negative safe integer is `unsupported field` and is not echoed.

A cancel/fill race appends the first of those two states. The other append fails with `transition is not allowed` and is not stored. The log never contains both `cancel` and `fill`. `closed` is true only when the accepted state is `cancel`. A fill is not a kill-switch close.

A restart replays the caller steps onto a new in-memory store from `createPaperOrderStore`. The caller store is not restored and is not merged. A second replay of the same steps is idempotent and does not add a second order. The paper log is not durable. `restored` stays false.

A stale balance creates no order and no position. The balance text is not copied onto the report. The result is BLOCKED with `balance reconciliation is NOT IN SOURCE`. A secret balance is `secret value is not allowed` and is not echoed.

The kill switch calls `decidePaperOrder` only when `killSwitch` is true. A request with the switch off returns `kill switch is not on` and does not call the gate. A switch that is on must return `kill switch is on`, create no order, leave existing paper states unchanged, and append one audit. The second call is an idempotent replay. `killSwitchClosed` stays false. This injection does not cancel, fill, or reconcile.

`duplicateOrder` stays false on a returned report. A detected second order returns an error instead of a success report. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true. No PostgreSQL table was added. `paper-orders.mjs`, `paper-decisions.mjs`, `paper-fills.mjs`, and `paper-queue.mjs` were not changed.

## Evidence

`pnpm test:paper-faults` passed 3/3, duration_ms 350.994656. The same create for `fixture-order` stays one order and one event after the replay inside the injection and after a second injection. Clock `60000` after create and acknowledge leaves states `create` and `acknowledge`, with `timeoutApplied` false. Cancel first leaves `create`, `acknowledge`, and `cancel`, rejects the fill with `transition is not allowed`, and does not store `fill`. Fill first leaves `create`, `acknowledge`, and `fill`, rejects the cancel, and leaves `closed` false. A restart replay of create and acknowledge reports one order and two events, `callerOrderCount` 0, and `restored` false. The caller store stays empty. Balance `fixture-balance` is BLOCKED with `balance reconciliation is NOT IN SOURCE` and is not copied. `bearer fixture-token` is `secret value is not allowed` and is not copied. An acknowledged `fixture-order` stays `create` then `acknowledge` after kill-switch decision `fixture-kill`. The decision error is `kill switch is on`. One audit is stored with `orderCreated` false. A later request with the switch off is `kill switch is not on` and adds no audit and no order. The module calls `appendPaperOrder` and `decidePaperOrder`. Its source has no `placeOrder`, Binance client, `fetch`, or WebSocket. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Clock `60000`, lag `1000`, fee `0.001`, and notional `1` are fixtures and are NOT IN SOURCE. Decision 0069 records the paper ledger reconciliation and does not change these faults.
