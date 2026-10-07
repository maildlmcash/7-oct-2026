# 0059 — Permitted historical datasets

Status: accepted for public, licensed, and user-authorized datasets. Unknown or unlicensed data is excluded. No dataset is fetched. No order is placed.

## Context

TASK 13.A.02 asks to import only public or licensed datasets and user-authorized project logs. Each dataset records provenance, rights, timezone, gaps, and exclusions. Another bot's private history is not obtained without authorization.

The source names those three rights and names no dataset table. Decision 0045 accepts timezone `UTC` for feature calculation. This import records the caller timezone and does not convert it. Decision 0058 replays events and does not import a dataset.

## Decision

`services/historical-datasets.mjs` exports `createHistoricalDatasetStore`, `importHistoricalDataset`, and `readHistoricalDataset`. A same-tenant Admin may import one dataset. A Customer is `role scope denied`.

The record stores provenance `source` and `reference`, rights, timezone, gaps, and exclusions. Rights must be `public`, `licensed`, or `user-authorized`. Any other rights value is `unlicensed or unknown data is excluded` and is not stored or echoed. Gaps and exclusions are caller strings. An empty list is an explicit record.

`privateBotHistory` true is stored only when rights are `user-authorized` and `authorization` is filled. Otherwise the result is `private history is not authorized` and nothing is stored. The module does not fetch a reference. A user-authorized log without authorization is `authorization is not configured`. The same dataset id with the same body returns the stored record. A different body is `dataset is already recorded`. No PostgreSQL table was added.

## Evidence

`pnpm test:historical-datasets` passed 3/3, duration_ms 160.636871. A public dataset stores source `fixture-source`, reference `fixture-reference`, timezone `UTC`, gap `fixture-gap`, and exclusion `fixture-exclusion`. A licensed dataset and a user-authorized private log with authorization `fixture-authorization` are stored. Rights `guessed` are excluded and not echoed. A public private-bot flag is `private history is not authorized`. A Customer import is `role scope denied`. A second tenant does not receive the first tenant's dataset. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. The source name, reference, gap, exclusion, and authorization text are fixtures and are NOT IN SOURCE. Decision 0060 records backtest fill accounting and does not change these dataset rules.
