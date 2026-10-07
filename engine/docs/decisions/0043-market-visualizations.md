# 0043 — Bounded market visualizations

Status: accepted for one bounded chart at a time. VWAP has no formula. The current whale list stays blocked.

## Context

TASK 10.B.01 asks for price/volume, spread, depth heatmap, CVD, VWAP, funding/OI/basis, liquidation, DEX liquidity, and whale-flow views with bounded queries and lazy loading. Tests must check units, time ranges, empty data, stale data, and mobile layout. No chart may imply a guaranteed direction.

Design pages 7–8 name those series. They name no chart library, color scale, pixel breakpoint, query bound, or direction guarantee. Decision 0042 leaves VWAP, volatility, and realized range as `NOT IN SOURCE`. Decision 0034 names book bounds 10, 25, and 50 and does not name a heatmap palette. Decision 0036 leaves `readCurrentWhaleEligibility` blocked with `evidence is insufficient`. `services/dex-pool-events.mjs` stores raw pool integers and is not a live liquidity feed. The shell page size 2 is the existing layout fixture.

## Decision

`services/market-visualizations.mjs` reads one named view. It does not build the other views in the same call. The caller must supply a positive integer bound. A missing or non-positive bound returns `bound is required`. The source names no chart error text, so these fail-closed strings are part of this decision. A missing `from` or `to` returns note `time range is not set` and no points. `from` greater than `to` is `unsupported field` and is not clamped. Points outside the inclusive range are dropped. When more in-range points exist than the bound, the earliest points are kept and `truncated` is true. Equal event times keep input order.

An empty series stays empty. An explicit zero stays zero. A stale flag, quality `degraded`, or unhealthy quality publishes no points and does not echo the supplied values. `direction` is null and `guaranteesDirection` is false on every result, including a rejected query.

Units are measure labels: `price and volume`, `price difference`, `price and quantity`, `taker buy minus taker sell`, `source value`, and `raw amount`. VWAP and whale-flow units stay null. The depth series is a price and quantity table with `palette` null. Supplied spread, CVD, funding, open interest, basis, and liquidation values are displayed as given. This module does not calculate them again. VWAP stays empty with formula `NOT IN SOURCE` and rejects a point list. Whale-flow calls `readCurrentWhaleEligibility`, rejects caller points, and returns the blocked empty list. A DEX amount must be a raw integer. `10000000` remains the existing raw example and is not shown as `0.01`.

The Market section mounts `MarketCharts` after the existing layout table and only while Market is selected. No series is read until a chart button is pressed. The shell passes bound 2 and no time range, so the page shows the unset range rather than invented points. Every width uses one column. Widths 375, 768, and 1280 remain fixtures. The visible sentence `This chart does not guarantee a direction.` states that limit. No eighth section was added. The words `market view` are not rendered. No chart library, socket, or order function was added. Decision 0044 draws model-health charts in the Predictions section and does not change these market series.

## Evidence

`pnpm test:market-visualizations` passed 3/3, duration_ms 152.579673. A bound of 2 keeps the earliest in-range price/volume points and drops the rest. Spread `0.0001`, CVD `1.5`, funding `0.0001`, open interest `12`, and liquidation `5` stay the caller-supplied feature fixtures. Omitted basis stays null. An explicit funding `0` stays `0`. A missing volume is `unsupported field` and is not written as zero. Stale and degraded series publish no points. VWAP with a price point is rejected and stays unplotted. Whale-flow returns blocked `BLOCKED`, error `evidence is insufficient`, and entries `[]`. Layout widths 375, 768, and 1280 all return columns 1 and stack `column`. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.

Playwright `tests/market-charts.spec.ts` and `tests/layout.spec.ts` passed 4/4 in 21.4s. Port 3468 was free, and Playwright started `next dev` itself. At the 375×667 fixture the Market table still shows two rows and `row-1`. Before a chart button, no points are plotted. Spread then shows `Unit price difference`, `time range is not set`, `No plotted points`, and `This chart does not guarantee a direction.` VWAP replaces that series with `NOT IN SOURCE`. Whale-flow replaces it with `evidence is insufficient`. The chart text has no buy, sell, long, short, up, or down direction. Mobile, tablet, and desktop layout checks still have no overlap and no horizontal overflow. `apps/web/next-env.d.ts` was restored to the `.next/types` imports after `next dev` rewrote them to `.next/dev/types`.
