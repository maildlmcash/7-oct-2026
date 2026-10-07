# 0056 — Futures feed faults

Status: accepted for injected mark, funding, open-interest, and liquidation faults. Each named fault suppresses the futures prediction. Spot data is not copied. No order is placed.

## Context

TASK 12.C.01 asks to inject a stale mark or index, a funding gap, an open-interest discontinuity, and a liquidation-feed outage, and to define which of those failures suppress predictions. Each fault needs a documented degraded or abstain state and an alert. The prediction must not fall back to Spot data.

Design page 9 says a stale funding, mark, or index feed, and a missing liquidation feed, withhold futures use. It names no numeric mark-index divergence limit. Design page 11 says a stale feature is vetoed rather than treated as neutral. Decision 0029 already uses `sequence gap` for a missing feed interval. Decision 0046 treats an age equal to the caller lag threshold as not late, and it names no maximum event age. The source names no open-interest discontinuity magnitude. Decision 0054 records the futures score. Decision 0055 records leverage caps and does not classify these faults.

## Decision

`services/futures-faults.mjs` exports `evaluateFuturesFaults`. These faults suppress the futures prediction:

- `stale mark/index` returns state `abstain`. A mark or an index is stale when its quality is unhealthy, its sequence is at or behind its watermark, its event time is after the receive time, or its age is greater than the caller lag threshold. An age equal to that threshold is not stale.
- `stale funding` returns state `abstain`. Design page 9 names a stale funding feed, so it suppresses even though the task's funding name is the gap.
- `funding gap` returns state `abstain`. The funding quality reason `sequence gap`, or a sequence more than one step after its watermark, is the gap. The next sequence is not a gap.
- `open-interest discontinuity` returns state `abstain` only when the caller injects `discontinuity: true`. A larger open-interest value with `discontinuity: false` does not abstain. The source names no jump size.
- `liquidation-feed outage` returns state `degraded`. Status `outage`, an unhealthy liquidation feed, or a late liquidation feed is the outage. An available feed with an empty event list is not an outage.

A suppressed result has a null score, a null prediction, `spotFallback` false, and one alert per failed feed. The alert carries the fault, the state, the source, and a known reason. An unknown quality reason is recorded as `degraded` and is not echoed. When any alert state is `abstain`, the result state is `abstain`. A liquidation outage alone stays `degraded` and still suppresses the score.

A healthy read echoes the supplied futures score and does not read the Spot object. A prediction whose product is not `futures` is rejected and does not publish that score. The module does not calculate a futures score, does not call `readMarketFeatures`, does not place an order, and does not add a PostgreSQL table. Decision 0057 records the futures review gate and does not change these faults.

## Evidence

`pnpm test:futures-faults` passed 3/3, duration_ms 240.804039. A healthy mark, index, funding sequence `9` after watermark `8`, open interest `1000000` with discontinuity false, and an available liquidation feed with an empty event list return score `14`, product `futures`, no alerts, and `spotFallback` false. The Spot bid `0.0025` and Spot score `22` are absent from that result. Receive time exactly one lag threshold later is not stale. The futures score `18` from PriceTrend `1` is echoed and a later score call still returns `18`. Mark age one millisecond past lag threshold `1000` returns state `abstain`, alert `stale mark/index` on source `mark` with reason `late event`, and a null score. Quality `stale stream` and a repeated sequence use reason `stale stream`. Funding sequence `10` after watermark `8` returns `funding gap`. Stale funding returns `stale funding` and does not keep score `14`. Injected open-interest discontinuity abstains and does not echo `1000000`. Liquidation status `outage` returns state `degraded`, alert `liquidation-feed outage`, and a null product. A Spot prediction product is `prediction product is not futures` and does not echo score `22`. The four task faults together return state `abstain` and those four alert names. Reason `guessed` is not echoed. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Lag threshold `1000`, the sequences, and the open-interest value are fixtures and are NOT IN SOURCE.
