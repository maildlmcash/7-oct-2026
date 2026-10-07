# Crypto Prediction Engine

Read-only crypto market research workspace. This repository is a runnable application scaffold with a live market UI, bounded public data connectors, a guarded prediction status, and a preview-only paper order panel.

## Requirements

- Node.js 20 or later
- pnpm 10.17.1 (Corepack can activate the pinned version)
- Network access for installation and live public data

## Run locally

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:3000`. The app uses one route; section navigation is client-side.

## Verify

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

`pnpm test` runs deterministic tests that do not need PostgreSQL. Use `pnpm test:database` only with a configured local PostgreSQL test database. Use `pnpm test:network` when outbound access to Binance is available. The Playwright UI test is `pnpm test:shell` and requires a Playwright browser installation.

## Connected data sources

| Source | Current behavior | Credentials | Limits |
| --- | --- | --- | --- |
| Binance Spot | Browser-side combined WebSocket adapter for public trades and best bid/ask | None | One selected symbol; read-only; actual connection requires outbound TLS/WebSocket access; connection state goes stale after 10 seconds without events |
| Binance USDⓈ-M Futures | Browser-side public mark-price/funding combined WebSocket adapter | None | One selected symbol; actual connection requires outbound TLS/WebSocket access; no private/account stream or orders |
| DexScreener | Server-side public pair search proxy | None | Search results only; not a DEX swap socket, trade router, token audit, or safety verdict |
| Blockscout Ethereum/Base | Server-side latest normal transaction lookup for an address selected by the user | None | Manual watchlist stored in that browser; not a verified whale list or buy/sell classifier |

The original target of 15 CEX integrations, 15 DEX venue integrations, and 15 verified active whales is a planned capacity, not an achieved connection state. The UI reports unconfigured slots. It does not prefill wallets or claim unknown addresses are whales. DEX on-chain event decoding and verified whale eligibility still need separate source adapters and evidence.

## Safety boundaries

- `LIVE_TRADING=OFF` and `LIVE_ORDERS_LOCKED=true` remain the required defaults.
- No exchange keys, private user streams, signing, spot orders, or futures orders are present in the browser app.
- The paper panel creates a JSON preview only; it does not persist a ledger or simulate fills.
- The prediction screen blocks scoring while required cross-venue, DEX, wallet, and calibration inputs are missing. Unknown data is not substituted with zero.
- Admin readiness labels are source status only; deployment, database, mobile, security, and release checks must be verified in their real environments.

## Current implementation map

- `apps/web/app/engine-workspace.tsx`: client UI, public exchange streams, DEX search, wallet activity, score gating, paper preview.
- `apps/web/app/api/dex/search/route.ts`: bounded DexScreener proxy.
- `apps/web/app/api/wallets/activity/route.ts`: fixed-host Blockscout address transaction proxy.
- `services/`: deterministic domain contracts and validators; most original planned modules are still not production-connected.
- `docs/AUDIT_AND_RUN.md`: source audit, implemented changes, and verified checks.
