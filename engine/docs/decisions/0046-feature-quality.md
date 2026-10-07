# 0046 — Feature leakage and quality checks

Status: accepted for point-in-time vetoes. No prediction score is calculated.

## Context

TASK 10.C.02 asks for point-in-time checks for late events, future timestamps, lookahead windows, and invalid source states. An invalid feature vetoes the dependent score. Synthetic leakage and stale-source tests must fail closed and name the exact feature and source.

Design page 8 says every feature value comes only from data up to the decision time, and it says to stop look-ahead leakage. Design page 1 removes a feed's signal when that feed's lag threshold is exceeded. Design page 10 names max event lag as an admin setting and gives no number. Decision 0029 treats an event time after the receive time as clock skew and adds no skew allowance. Decision 0042 already treats unhealthy quality, including `stale stream` and `degraded`, as a source that publishes no feature numbers. Phase 11 has not been pasted, so this tree still has no Spot score.

## Decision

`services/feature-quality.mjs` exports `checkFeatureQuality`. The caller supplies the decision time, the receive time, a lag threshold, and one or more feature rows. Each row names one of the ten canonical features, one source, an event time, a window, and a source quality. The same input returns the same result.

An event time after the receive time is check `future timestamp` and error `clock skew`. A receive time that exceeds the event time by more than the caller lag threshold is check `late event`. A feature event, or a window end, after the decision time is check `lookahead window`. A missing window is `lookahead window is not configured`. Quality `stale stream`, `degraded`, `sequence gap`, `clock skew`, `reorg`, or `unverified` is check `invalid source` and keeps that reason. Any other unhealthy reason is `invalid source` and is not echoed. A missing decision time, receive time, lag threshold, feature, source, or quality fails closed.

The result score is always null. `vetoed` is true when a check fails. A caller-supplied score is not copied. This module does not calculate `S_spot`, a probability, or a direction. It does not change the feature formulas or the feature-version store. The lag threshold `1000` and the source names in the test are fixtures. No PostgreSQL table was added. Decision 0047 stores Spot label versions and point-in-time cutoffs and does not change these checks.

## Evidence

`pnpm test:feature-quality` passed 3/3, duration_ms 197.297656. Two checks of spread and CVD from source `fixture-source`, decision time `1499865549590`, and receive time `1499865549591` match and both leave score null. The supplied score `91` is not in the result. An age equal to lag threshold `1000` is not late. Event time `9007199254740993` against receive time `9007199254740992` is clock skew on feature `liquidation` and source `digit-source`. A CVD event older than the threshold is `late event` on source `late-source`, while a healthy spread in the same call is not the reported feature. A VWAP window ending one millisecond after the decision time is `lookahead window` on source `lookahead-source`. Basis event time `1499865549600` with a later receive time is the same lookahead check on source `later-source`. Depth imbalance with reason `stale stream` names source `stale-source`. Open interest quality `degraded` names source `degraded-source`. Liquidation reason `sequence gap` names source `gap-source`. An unknown quality reason is `invalid source` and is not echoed. A missing lag threshold vetoes and publishes no score. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
