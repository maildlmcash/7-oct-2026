# 0032 — Trader input interface

Status: accepted for the read-only trader input contract.

## Context

TASK 08.A.01 asks for a read-only typed interface from normalized market data to the existing trader and prediction consumers. The interface includes venue, symbol, product, BBO, event age, quality state, and sequence watermark. Stale, incomplete, and wrong-product input must be rejected. Order placement must not be exposed.

The repository has no trader, scorer, prediction, or paper-book consumer. The shell section name Predictions is a button label. This task defines the contract a later consumer can read. It does not connect one. The design vetoes stale input. The source names no maximum event age. Spot bookTicker prices stay decimal strings. The official bookTicker example has update id `400900217` and no event timestamp. Decision 0028 stores last-trade price and quantity, which are not a BBO. Decision 0029 names an unhealthy book, including reason `stale stream`. Queue quality `degraded` is an unhealthy state. The USD-M adapter records product `USD-M`.

## Decision

`packages/contracts/src/trader-input.mjs` exports `readTraderInput`. A complete input returns a frozen view with venue, symbol, product, BBO decimal strings, event age, quality `{healthy:true, reason:null}`, and `sequenceWatermark` set to the accepted sequence. `expectedProduct` is an input check and is not on the view. The first read uses `sequenceWatermark` null. A sequence less than or equal to a watermark is stale. Comparison keeps a digit string and does not use `Number()`. A negative event age is stale because it is the existing clock-skew direction. A large non-negative event age is not rejected, because the source names no maximum. Quality `healthy` false, reason `stale stream`, or queue quality `degraded` is stale. A product that does not equal `expectedProduct` is rejected and returns no view. Unknown keys, including an order object and last-trade `price` and `quantity` on the BBO, are incomplete and return no view. The module exports no order function. It does not place orders, open a network connection, or change the envelope, adapters, book sync, queue, or soak.

## Evidence

`pnpm test:trader-input` passed 5/5. The accepted view freezes the official bookTicker decimals and sets the watermark to `400900217`. Event age `999999999` is accepted. A digit-string sequence stays a string. Incomplete input, an order key, stale quality, a negative age, an old watermark, and product `USD-M` against expected product `Spot` each return `BLOCKED` and no view. The export list is `readTraderInput` and `TRADER_INPUT_VIEW_KEYS`. `pnpm health` stayed `liveTrading` `OFF` and `liveOrdersLocked` true.
