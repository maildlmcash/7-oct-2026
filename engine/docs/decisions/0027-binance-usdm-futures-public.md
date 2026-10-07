# 0027 — Binance USD-M public futures market data

Status: accepted for the public USD-M futures adapter.

## Context

TASK 07.A.02 asks for one futures public market-data product, its own instrument model, and explicit product units, mark price, index price, and contract metadata. Missing contract metadata must block downstream use.

Decision 0026 reads Binance Spot only. Design section 4 lists USD-M separately from Spot and from COIN-M. The USD-M common definition says the base asset is the quantity of a symbol and the quote asset is the price of a symbol. The source names no second futures product for this task.

## Decision

`services/binance-usdm-futures-public.mjs` is the USD-M adapter. It does not parse Spot instruments and it does not place orders. A contract records `contractType`, delivery date, onboard date, status, quantity unit, price unit, and margin unit. Quantity unit is the base asset. Price unit is the quote asset. Margin unit is `marginAsset`.

`useUsdMMarket` returns mark price and index price only after the contract metadata is complete and the premium index symbol matches. The two prices stay separate strings. A missing contract field, a missing index price, or a symbol mismatch returns `BLOCKED` and no market object. The recorded docs catalog is Futures (USDⓈ-M) REST API 1.0.0, checked on 2026-10-06. The public origin is `https://fapi.binance.com`. Decision 0028 keeps the canonical event envelope in a separate module.

## Evidence

`pnpm test:binance-usdm-futures` covers a USD-M perpetual contract, a Spot ETHBTC instrument, different symbols and units, a blocked missing margin asset, a blocked missing index price, and a rejected order path.
