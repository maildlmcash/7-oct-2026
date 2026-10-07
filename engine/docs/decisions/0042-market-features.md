# 0042 — Core market features

Status: accepted for the source-backed feature formulas. Three formulas remain unnamed.

## Context

TASK 10.A.02 asks for spread, depth imbalance, CVD, VWAP, volatility, realized range, funding, open interest, basis, and liquidation, with event-time watermarks and source quality. Reference fixtures must verify each formula and timestamp. A missing input must stay missing rather than become zero.

Design page 7 names spread and depth imbalance beside the order book, CVD as taker buy minus taker sell, and VWAP, realized volatility, and ATR as chart series. It also names open interest, funding, basis, and liquidation events as futures metrics. Design page 8 writes OBI as `(bid depth − ask depth) / (bid depth + ask depth)` and CVD as normalized cumulative taker buy minus sell. It names no CVD divisor, no VWAP formula, no volatility formula, and no realized-range formula. Decision 0034 already defines spread as the best ask minus the best bid and keeps a non-terminating ratio as a reduced fraction. Decision 0032 treats a sequence at or behind the watermark as stale. The source names no rounding scale.

## Decision

`services/market-features.mjs` returns the ten features. Spread is the best ask minus the best bid, and a non-positive result stays missing. Depth imbalance uses the design OBI ratio. A zero denominator stays missing. CVD is the cumulative taker-buy quantity minus the cumulative taker-sell quantity. The source names no normalization divisor, so the difference is not rescaled. A trade with a missing side or quantity makes CVD missing. VWAP, volatility, and realized range stay null with formula `NOT IN SOURCE` even when trade prices are present.

Funding, open interest, basis, and liquidation are copied source decimals. An omitted field stays null. An explicit zero stays zero. Basis is not derived from funding. A present value carries the caller event time. The accepted event time is `inputWatermark`. A sequence at or behind `sequenceWatermark`, or unhealthy quality, publishes no feature numbers. The module does not place an order and does not read the analytical store. Decision 0043 draws bounded chart series from caller-supplied values and does not change these formulas.

## Evidence

`pnpm test:market-features` passed 3/3, duration_ms 152.849976. Bid `0.0025` and ask `0.0026` give spread `0.0001` at event time `1499865549590`. Depths `4` and `4` give imbalance `0`. Depths `3` and `4` give `-1/7`. Taker buy `2.5` minus sell `1` gives CVD `1.5`. The same trades leave VWAP, volatility, and realized range null. Funding `0.0001`, open interest `12`, and liquidation `5` keep those decimals and the same event time. Omitted basis stays null. A missing bid, a zero depth total, and a sell without quantity stay null and are not written as zero. An explicit funding `0` stays `0`. An equal bid and ask leaves spread null. Sequence `28457` repeated against watermark `28457` is stale and publishes no numbers. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
