# 0049 — Spot signed baseline

Status: accepted for the versioned signed linear score. Calibrated probability stays null. No order is placed.

## Context

TASK 11.B.01 asks for a versioned baseline that uses approved signed features, keeps the raw score distinct from calibrated probability, and starts with a simple logistic or gradient-boosted baseline before a complex model. Tests must cover sign, nulls, clipping, and deterministic output. A model card must state intended use and limitations.

Design page 8 publishes `S_spot` as 100 times (0.22·OBI + 0.20·CVD + 0.16·TradeImbalance + 0.14·TrendRegime + 0.12·DEXNetFlow + 0.10·WhaleVerifiedFlow + 0.06·CrossVenueBreadth), clamped from -100 to +100. Each component is a directional value from -1 to +1. OBI is bid depth minus ask depth, divided by their sum. CVD is normalized cumulative taker buy minus sell. The same page names a rolling robust z-score and clipping, and it names `P(up)` as a calibrated logistic of `β₀ + β·features`. It says to compare a logistic or gradient-boosted baseline and isotonic or Platt calibration on walk-forward folds. It does not give the z-score window, the logistic coefficients, the boosted hyperparameters, or the calibration map. Design page 11 says the baseline is a logistic/calibrated model, that weights are versioned, and that auto-learning does not change production weights. The futures score on the same page is a separate formula. Decision 0048 calculates executable costs and does not calculate this score.

## Decision

`services/baseline-model.mjs` exports `createBaselineStore`, `registerBaselineModel`, and `scoreBaselineModel`. The stored weights are the published integer percents 22, 20, 16, 14, 12, 10, and 6. A caller cannot replace them. Registering the same version again is idempotent. Another version id records the same weights and returns its own model version.

Each signed component is clipped to the closed interval from -1 to +1 before it is weighted. The total is clamped to the closed interval from -100 to +100. Comparison and division use scaled integers. A non-terminating ratio stays a reduced fraction. A null, missing, or blank component does not become zero. The score stays null and the error is `signed feature is missing`. An unknown value is `unsupported field` and is not echoed.

`score` and `calibratedProbability` are different fields. `calibratedProbability` stays null. The z-score window, logistic coefficients, gradient-boosted hyperparameters, and isotonic or Platt map are NOT IN SOURCE, so this version does not fit them and does not turn the raw score into a probability. The futures score is not calculated. Fees, spread, and slippage are not subtracted here. The whale list is not a feature source. The module does not place an order. No PostgreSQL table was added. The model card is `docs/model-cards/spot-baseline.md`. Decision 0050 records the walk-forward report and does not change this score.

## Evidence

`pnpm test:baseline-model` passed 3/3, duration_ms 142.360056. All components at `1` score `100`. All components at `-1` score `-100`. All components at `0` score `0`. OBI `1` with the others at `0` scores `22`. OBI `-1` scores `-22`. OBI `1` and CVD `-1` score `2`. OBI `1`, CVD `-1`, and TradeImbalance `-1` score `-14`. OBI `-1/7` scores `-22/7`. OBI `2`, `1.0`, and `3/2` each clip to the same score `22`. OBI `-3` and `-1.5` each clip to `-22`. A null OBI with the other components at `1` stays null and does not become `78`. The same call repeated through `structuredClone` matches. `calibratedProbability` is null on every result. An unregistered version does not score. A caller-supplied weight set is `unsupported field` and is not stored. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The version id `fixture-baseline` is a test fixture and is NOT IN SOURCE.
