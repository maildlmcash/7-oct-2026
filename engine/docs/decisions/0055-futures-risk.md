# 0055 — Futures risk diagnostics

Status: accepted for leverage, margin mode, and liquidation-distance diagnostics. A missing input or a failed cap returns NO_TRADE. No order is placed.

## Context

TASK 12.B.02 asks for explicit risk diagnostics: the leverage assumption, the margin mode, a liquidation-distance estimate, and NO_TRADE when a required input is missing or a risk limit fails. Boundary tests must cover the caps and the abstention. Model output must not change leverage or submit an order.

Design page 9 says each symbol and strategy has an admin-configured max leverage, max notional, maintenance-margin buffer, and liquidation-distance floor. It does not give those numbers. It does not give a liquidation-distance formula. It names hedge mode and one-way mode as position modes, and it does not name a margin-mode list. Decision 0053 records position mode and does not score risk. Decision 0054 records the futures score and does not apply these caps.

## Decision

`services/futures-risk.mjs` exports `readFuturesRisk`. The caller supplies the leverage assumption, max leverage, margin mode, notional, max notional, maintenance-margin buffer, maintenance-margin buffer floor, liquidation distance, and liquidation-distance floor. A missing key is `unsupported field`. A blank field returns its own not-configured error. A value that is not a non-negative decimal is `unsupported field` and is not echoed. Explicit zero stays zero.

The margin mode is the caller string. The source names no allowed list, so the string is recorded and is not mapped to leverage. The liquidation distance is the caller decimal. Its formula is `NOT IN SOURCE`, so this module does not derive it from mark, leverage, or margin. Equal to a max or a floor passes, because that value does not exceed the max and is not below the floor. Leverage or notional above its max, a buffer below its floor, or a distance below its floor returns action `NO_TRADE` and leaves the supplied leverage text unchanged.

A passing read has action null, `leverageChanged` false, and `orderSubmitted` false. The futures score in `services/futures-baseline.mjs` is not called and is not given a leverage field. The module does not place an order and does not add a PostgreSQL table. Decision 0056 records the futures feed faults and does not change these caps.

## Evidence

`pnpm test:futures-risk` passed 3/3, duration_ms 384.668328. Leverage `2` against max `2`, notional `10` against max `10`, buffer `0.050` against floor `0.05`, and distance `0.2` against floor `0.2` pass. The returned leverage stays `0.050` when that is the supplied text. Margin mode `fixture-margin` and `fixture-margin-2` are both recorded, and neither changes leverage `2`. Leverage `2.1` against max `2` returns `NO_TRADE` with error `leverage cap is exceeded` and leverage assumption `2.1`. Notional `10.1` returns `notional cap is exceeded`. Buffer `0.049` returns `maintenance-margin buffer is not met`. Distance `0.199` returns `liquidation distance is below the floor`. A blank leverage, a blank margin mode, and a blank distance abstain. A missing leverage key and a payload that also carries score `100` return `unsupported field` and a null leverage assumption. The score `100` is not echoed. Leverage `-1` is not echoed. The same futures score before and after the diagnostic is `100`, and the score object has no leverage field. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The cap numbers, margin-mode text, and duration fixture are NOT IN SOURCE.
