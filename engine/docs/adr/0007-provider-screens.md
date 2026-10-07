# 0007 — Provider registry screens

Status: accepted for task 1.C.1.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/features/providers/` and `packages/contracts/src/providers/`. This tree has no `apps/control-web/` directory. ADR 0002 keeps the shell in `apps/web`.

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/features/providers/` | `apps/web/app/features/providers/` |
| `packages/contracts/src/providers/` | `packages/contracts/src/providers/` |

Paths above are relative to `engine/`. `services/provider-registry.mjs` and migration `0008_provider_registry.sql` stay as they are. Their kinds remain CEX, DEX, chain, market-data API, and WebSocket. This screen does not add a SQL kind and does not open a connection.

## Decision

1. The control-room lists are CEX, DEX, data vendor, and wallet-monitoring. Each row shows status, product, version, last verified, and source URL. The table can be filtered and sorted.
2. A blank source URL is `NOT_CONFIGURED`. A source URL is `NOT_TESTED`. Last verified stays empty. This phase does not record a connection test.
3. Detail tabs are REST, WebSocket, chain/RPC, fields, calculations, and permissions. Capability labels are separate: `public-read-only`, `account-read`, and `trade`. Account-read and trade stay unavailable. Trade does not place an order. Wallet-monitoring stores no address and no balance.
4. An Admin of the same tenant may edit product, version, and source URL. Any other field, including status and last verified, is rejected. A secret value is rejected. A non-Admin is `role scope denied`.

## Non-claims

- No exchange credential, wallet key, or live order is stored.
- No LIVE market status is added.
- The screen fixture is MOCK catalog metadata.

## Evidence

- `tests/provider-screens.mjs`
- `apps/web/tests/provider-registry.spec.ts`
- `docs/architecture/evidence/1-c-1/`
