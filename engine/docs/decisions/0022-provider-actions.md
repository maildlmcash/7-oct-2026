# 0022 — Provider test and fetch actions

Status: accepted for separate manual actions and a gated auto start.

## Context

TASK 06.B.01 asks for separate Test Connection, Fetch Once, and Auto Start actions. Auto Start defaults off. A live data subscription needs a scoped permission and a confirmation. Auto stays disabled after create and import. API and UI checks must show the actions are distinct.

Decision 0020 stores versioned provider rows. Decision 0021 stores a read-only market-data vault reference separately from order-capable credentials. The source names no endpoint URL, no confirmation phrase, and no secret-manager product. The shell has no provider screen. Design section 2 says the first connection and fetch stay manual.

## Decision

`createProvider` and `importProvider` store `autoStart: false` even when the caller sends true. Neither writes an action. `testConnection` records `test-connection`. `fetchOnce` records `fetch-once`. Neither sets auto on, and neither records the other action. `startAuto` records `auto-start` only when the actor is a same-tenant Admin, `confirmation` is exactly true, and the provider has the read-only market-data scope. Order credentials alone do not enable it. A denied attempt writes no action and no audit.

The stored registry row stays `autoStart: false`. The subscription state is the auto-start action. Every action records `connected: false` and `fetched: false`. The module does not open a network connection and does not read live trading flags. Decision 0023 records health and limit observations on this registry. `displayProviderActions` shows the three action names and whether auto is on. `data/migrations/0010_provider_actions.sql` keeps `provider_registry.auto_start` false and stores the three actions in an append-only table. Test and fetch rows cannot set auto on. An auto-start row requires confirmation.

## Evidence

`pnpm test:provider-registry` covers create and import with auto off, distinct test and fetch results, a rejected confirmation, a rejected order-only subscription, and the display lines for the three actions.
