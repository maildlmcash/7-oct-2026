# 0045 — Versioned feature definitions

Status: accepted for immutable feature-definition versions and replay. Lookback is recorded and not applied. No prediction score is calculated.

## Context

TASK 10.C.01 asks to version each feature formula, lookback, timezone, source priority, and null policy, and to persist the version used for every prediction. Replaying identical events under the same version must yield identical feature output.

Decision 0042 fixes the ten feature formulas. A missing input stays null. Design page 7 says exchange timestamps are UTC and display may use the local timezone. Design page 2 says each feature records an input watermark and a calculation version. The source names no lookback duration, no venue priority order, and no feature-version table. Phase 11 has not been pasted, so this tree has no prediction score.

## Decision

`services/feature-versions.mjs` stores immutable definition versions in memory. A version names all ten features. Each row has the canonical formula, a caller-supplied lookback, timezone `UTC`, a caller-supplied source-priority list, and null policy `missing stays null`. A missing lookback, timezone, source priority, or null policy is rejected and calculates nothing. A timezone other than `UTC` is `timezone is not supported`. A null policy other than `missing stays null` is `null policy is not supported`. A formula that differs from decision 0042 is `formula is not supported`.

Replay calls `readMarketFeatures` and stamps the version, lookback, timezone, source priority, and null policy onto each feature. The same version and the same events return the same feature values, watermarks, and version fields. Lookback and source priority are stored on that stamp. The source names no lookback duration and no cross-venue merge rule, so this module does not apply a window and does not choose among venues. Registering the same version id with a different lookback is rejected and the first definition remains.

`recordPredictionFeatures` writes a prediction id only with the replay result. The stored row cites `featureVersion`. A second write with a different version is `prediction version is already recorded` and does not replace the first row. A missing version writes nothing. The prediction id is caller-supplied. The row has no score and no direction. The store is the process memory. The source names no feature-version table, so no PostgreSQL migration was added. Decision 0046 checks point-in-time leakage and source quality and does not change these versions.

## Evidence

`pnpm test:feature-versions` passed 3/3, duration_ms 227.125719. Version `fixture-1`, lookback `fixture-lookback`, source priority `fixture-source`, and prediction id `prediction-1` are fixtures. Two replays of the same book, bid `0.0025` and ask `0.0026`, both return spread `0.0001`, depth imbalance `0`, CVD `1.5`, funding `0.0001`, liquidation `5`, and null VWAP, volatility, realized range, and basis. The JSON text of the two replays matches. A repeated sequence `28457` is stale on both replays and publishes no numbers. A missing bid stays null, and an explicit funding `0` stays `0`. An empty lookback, an empty timezone, timezone `local`, an empty source priority, an empty null policy, null policy `zero`, and formula `guessed` are rejected, and the rejected formula is not echoed. Prediction `prediction-1` keeps version `fixture-1` after a later write tries version `fixture-2`. Prediction `prediction-2` can cite `fixture-2`. The feature values match and the lookback text differs. A missing version stores no prediction. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
