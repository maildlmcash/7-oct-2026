# 0065 — Paper decision gate

Status: accepted for a paper-only Spot decision. A prediction without data approval or risk approval creates no order. Each well-formed decision is an append-only audit. Live orders stay locked.

## Context

TASK 14.A.02 asks to connect versioned Spot prediction output to a paper decision policy with configurable limits, fees, max notional, and a kill switch, and to keep live orders locked.

Design page 8 names the execution gate as predicted expected move minus estimated round-trip fees, spread, slippage, and a safety buffer. It also requires sufficient depth, passing feed quality, and passing position limits. It names no expected-move formula, no fee rate, and no safety-buffer number. Design page 9 names HALT KILL_SWITCH as blocking new orders, and it also names cancel, reconcile, and an operator alert. Design page 10 names a no-trade band and Spot execution caps and names no numbers.

Decision 0049 scores a registered Spot baseline version and leaves `calibratedProbability` null. Decision 0046 vetoes a late event, a future timestamp, a lookahead window, or an invalid source. Decision 0048 walks the visible book for the round-trip fee, spread, and slippage, and it does not apply the safety buffer. Decision 0064 appends a paper Spot order and does not open a venue client.

`LIVE_TRADING` and `LIVE_ORDERS_LOCKED` are not read from the environment. The frozen health pair stays `OFF` and `true`.

## Decision

`services/paper-decisions.mjs` exports `createPaperDecisionStore`, `decidePaperOrder`, `readPaperDecision`, and `PAPER_DECISION_LIMITATIONS`.

The prediction is the registered Spot baseline version and its features, scored by `scoreBaselineModel`. The feature version is the caller string cited on the audit. Data approval is a passing `checkFeatureQuality` result and a scored model version. The caller cannot set an approval flag.

Risk approval is a kill switch that is off, a notional at or under the caller max notional, and a fee walk that `readExecutionCost` accepts. Equal notional passes. Explicit zero stays zero. A negative or non-decimal notional, max, or fee is `unsupported field`, is not echoed, and is not audited.

An order is appended only when both approvals pass. The append is `appendPaperOrder` with state `create` and product `spot`. `venueClient` stays null. `liveOrderSubmitted` stays false. `liveTrading` stays `OFF`. `liveOrdersLocked` stays true.

A well-formed request always appends one frozen audit, including a refusal. A malformed request, a secret, an unknown key, or a non-Admin returns no audit and no order. The same idempotency key and the same body return the stored audit with `idempotentReplay` true and do not append another order. A different body is `decision is already recorded`.

Expected move, the no-trade band, the safety buffer, and any limit other than the caller max notional stay `NOT IN SOURCE`. The score is not converted into an expected move. A score of 100 does not by itself create an order. This gate does not evaluate the page 8 inequality, because the expected move and the safety buffer are not in the source. The kill switch blocks the new paper create. It does not cancel an open paper order, reconcile, or alert. No PostgreSQL table was added. The module does not import a venue client.

## Evidence

`pnpm test:paper-decisions` passed 3/3, duration_ms 262.005727. Decision `fixture-decision` scores model `fixture-baseline` at `100`, cites feature version `fixture-features`, and appends one paper order `fixture-order` in state `create`. `calibratedProbability` stays null. Notional `1` equals max notional `1`. The fee walk on the decision 0034 book at quantity `3` and fee `0.001` records net return `-1051/25500` and the execution-cost formula. Replaying `fixture-key` returns the same frozen audit and leaves one order and one audit stored. A lookahead on `fixture-leak` is `lookahead window`, leaves `dataApproved` false, records feature `spread` and source `fixture-source`, and creates no order. A kill switch is `kill switch is on` and creates no order. Notional `1.1` is `notional cap is exceeded` and creates no order. Quantity `5` is `depth is not sufficient`, leaves `netReturn` null, and creates no order. The first audit array stays length 1 after those later audits. Missing version `fixture-missing` is `model version is not configured`, leaves the score null, and creates no order. A Customer is `role scope denied` and writes no audit. Evidence text `bearer fixture-token` is not echoed. A quality field `score` is `unsupported field` and `91` is not echoed. The same leak key with notional `0` is `decision is already recorded` and leaves the order count at zero. A cross-tenant read is `decision is not configured`. The module calls `scoreBaselineModel`, `checkFeatureQuality`, `readExecutionCost`, and `appendPaperOrder`. Its source has no `placeOrder`, Binance client, `fetch`, or WebSocket. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Fee `0.001`, lag `1000`, and notional `1` are fixtures and are NOT IN SOURCE. Decision 0066 records the depth-aware paper fill and does not change this gate.
