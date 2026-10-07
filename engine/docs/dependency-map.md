# Dependency and integration map

This map describes the current repository, not the full planned engine.

## Runtime packages

- `apps/web`: Next.js App Router with React. Run via `pnpm dev`, `pnpm build`, or `pnpm start` from the root.
- `packages/contracts`: shared client view state and role/trader input contracts.
- `packages/ui-kit`: structural accessible layout primitives.
- `services/`: deterministic domain services and validators. Most are not connected to external market sources or persistence.
- Node.js 20+ and pnpm 10.17.1 are expected. Python is not a runtime dependency.

## Data call sites

| Input | Entry point | Network behavior | Output / state |
| --- | --- | --- | --- |
| Binance Spot trade + book ticker | Browser `WebSocket` from `apps/web/app/engine-workspace.tsx` | Combined public feed; no credentials | Recent trades, bid/ask, spread, freshness; no order calls |
| Binance USDⓈ-M mark/funding | Browser `WebSocket` from the same component | Public market stream on `/market/stream`; no account stream | Mark, index, funding and connection freshness |
| DEX search | `apps/web/app/api/dex/search/route.ts` | Server-side GET to fixed DexScreener public search endpoint, 8-second timeout, 30-pair limit | Normalized pair, price, liquidity and volume data |
| EVM address activity | `apps/web/app/api/wallets/activity/route.ts` | Server-side GET to fixed Ethereum/Base Blockscout hosts, 8-second timeout, 50 transaction limit | Recent transaction metadata for user-selected address |

## Dependencies on infrastructure

- External API availability and outbound network access are required for live public data.
- No PostgreSQL, Redis, Kafka, object store, or secret vault client is wired to these UI call sites.
- Database migrations and corresponding integration tests are separate and require PostgreSQL.
- Provider credential storage, role administration, and production release infrastructure are not connected.

## Planned versus connected

| Target | Connected now | Missing |
| --- | --- | --- |
| 15 CEX | Binance Spot + Binance USDⓈ-M Futures public streams | 14 independent venue adapters, normalization, cross-venue health/quorum |
| 15 DEX venues | DexScreener indexed pair search (not a venue execution adapter) | DEX pool/WebSocket or chain log adapters, swap decoding and reorg handling |
| 15 active whales | None preloaded; local user-entered activity watchlist supports up to 15 slots | Evidence-backed identity, activity thresholds, verified flow classifier and provenance |
| Prediction | Guarded unavailable state | Current feature graph, model training, calibration and time-split validation |
| Automatic trading | None; live order path locked | Paper ledger/reconciliation first; any live path requires separate release authorization |

See [AUDIT_AND_RUN.md](./AUDIT_AND_RUN.md) for the source audit and current verification record.
