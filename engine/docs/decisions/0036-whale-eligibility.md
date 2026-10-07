# 0036 — Active whale eligibility

Status: accepted for the eligibility process. The current list is BLOCKED.

## Context

TASK 08.C.02 asks for an auditable eligibility process for exactly 15 active whale entities. It uses recent movement, materiality, identity confidence, and last-seen windows. Dormant and deactivated accounts, exchange and bridge wallets, and likely self-transfers are excluded. A transfer is not automatically a buy or a sell. The current list must carry timestamps and evidence and contain exactly 15 entries, or show BLOCKED when evidence is insufficient.

Design section 6 says not to hard-code 15 wallet addresses and not to treat exchange or custody internal transfers as whale buys or sells. The activity default is at least one material non-internal event in 7 days and at least 3 material events in 30 days. An admin may change that threshold. Materiality is normalized by the token or pair's 24 hour volume and market depth. One fixed USD cutoff for every asset is not named. Attribution labels exchange, bridge, custodian, treasury migration, smart contract, router, and self-transfer stay separate. Ambiguous or low-confidence attribution is not a market-moving signal. Direction is recorded only for a DEX swap, a known venue flow, or a verified execution event. Duplicate addresses are grouped at entity level. Auto removal covers 30 days without material activity, a stale label, a changed contract classification, a provider data gap, or an anomaly.

The starting sort is WhaleRank = 0.30·ActivityRecency + 0.25·LiquidityRelativeSize + 0.20·AttributionConfidence + 0.15·VerifiedExternalFlow + 0.10·HistoricalImpact. Each component is on a 0–1 scale. This sorts the watchlist. It is not a trade-direction score. The design names a confidence floor and does not give its number. Arkham's top-100 holdings note is a holdings snapshot, not an active trader list. The design also says this workflow does not declare a current top 15 by inventing names or addresses. Unconfirmed identity stays `unlabelled entity`.

No whale module or evidenced address list existed in this tree.

## Decision

`services/whale-eligibility.mjs` ranks caller-supplied entities and writes an exclusion reason for every entity that fails a gate. The current list, `readCurrentWhaleEligibility`, has no stored evidence and returns `blocked` `BLOCKED` with error `evidence is insufficient` and no entries. A caller may supply 15 fixture entities with timestamps, label source, evidence, and the five rank components. The published entries are then exactly 15, each with last-seen, verified-at, and evidence. Fewer than 15 eligible entities stays BLOCKED and does not pad the list. A tie across the 15th place stays BLOCKED. Transfers keep a null flow direction. Self-transfers, exchange-internal transfers, dormant and deactivated labels, exchange and bridge wallets, stale labels, and low attribution are excluded and explained. Identity on an entry is `unlabelled entity`. Fixture addresses are not a current whale list. The module does not place an order. Decision 0037 defines versioned search documents and does not rank these entities.

## Evidence

`pnpm test:whale-eligibility` passed 4/4. Dormant, deactivated, exchange, bridge, self-transfer, exchange-internal, stale label, low attribution, no recent movement, a short activity count, activity older than 30 days, a shared address, and an unknown price are excluded with reasons. The price `0.001` and the name `Satoshi` are not stored. Fifteen fixture entities produce ranks, last-seen timestamps, and evidence references. The lowest fixture rank is `0.85`. Fourteen eligible entities return `evidence is insufficient` and an empty entry list. `readCurrentWhaleEligibility` returns the same BLOCKED shape and no fixture address. Sixteen equal scores return `tie at rank boundary`. A transfer submitted as a buy stays `flowDirection` null. A seventeenth lower score is withheld as `outside top 15`. `pnpm health` stayed `liveTrading` `OFF` and `liveOrdersLocked` true.
