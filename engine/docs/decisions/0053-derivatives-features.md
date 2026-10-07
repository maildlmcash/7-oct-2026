# 0053 — Derivatives features

Status: accepted for signed derivatives inputs with source timestamps and quality flags. Funding does not set a direction. No order is placed.

## Context

TASK 12.A.02 asks for funding, open interest, basis, mark/index divergence, liquidation events, and position-mode inputs. Each input needs a source timestamp and a quality flag. Tests must validate signs and units. Funding alone must not determine direction.

Design page 7 names open interest, funding, basis, mark/index, and liquidation events as futures metrics. Design page 8 keeps those inputs out of the Spot score. Design page 9 says funding alone is not a short or long rule, and it names hedge mode and one-way mode. It also says a stale mark or index feed withholds new futures orders. The source names no divergence divisor, no basis formula, no funding interval conversion, and no numeric divergence limit. Decision 0042 already copies funding, open interest, basis, and liquidation as core source decimals under one event time. Decision 0052 records the contract whose price unit and quantity unit these features use. The futures signed score is a later task.

## Decision

`services/derivatives-features.mjs` exports `readDerivativesFeatures`. The read uses a registered contract for units. An unknown contract returns `BLOCKED` and no feature list. Funding and basis keep the caller sign. Open interest is a non-negative source quantity. A negative open interest is rejected and is not stored. Mark/index divergence is mark minus index, in the contract price unit. A missing or unhealthy mark or index leaves the divergence null. Basis is not rewritten from that difference. Liquidation events sum positive quantities in the contract quantity unit. A negative liquidation quantity is rejected. Position mode is `hedge` or `one-way`.

A supplied input without a source timestamp is rejected. An unhealthy quality flag withholds that value and leaves the other healthy values in place. An omitted input stays null and is not written as zero. An explicit funding zero stays zero. The result direction is null for funding alone and for funding beside the other inputs. The module does not calculate a futures score, does not change `services/market-features.mjs`, and does not place an order. No PostgreSQL table was added. Decision 0054 records the futures baseline and does not change these features.

## Evidence

`pnpm test:derivatives-features` passed 3/3, duration_ms 169.621008. On the linear fixture, funding `0.0001` stays positive with unit `funding rate`, open interest `12` has quantity unit `BTC`, and basis `-0.5` keeps its sign with unit `source value`. Mark `100.5` at the later timestamp minus index `100` is divergence `0.5` in `USDT`, and the feature time is the earlier source time. Liquidation quantities `3` and `2` sum to `5` in `BTC`. Position mode `hedge` has a null unit. The same call through `structuredClone` matches. Funding `-0.0001` stays negative, and mark `99` minus index `100` is `-1`. Funding `1` alone, funding `0`, and funding beside the other inputs all leave direction null. The inverse fixture reports open interest in `contract` and divergence `10` in `USD`, while basis stays `-1`. A missing contract, a negative open interest, a negative liquidation, a negative mark, an unknown position mode, and a missing timestamp publish no feature list. Degraded funding stays null while a healthy mark and index still diverge. An unhealthy mark leaves divergence null and does not clear a healthy funding value. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The contract ids, currency codes, and funding interval `8` remain the contract-spec fixtures and are NOT IN SOURCE.
