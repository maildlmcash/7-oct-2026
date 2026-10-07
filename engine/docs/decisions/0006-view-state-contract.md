# 0006 — Typed view state

Status: accepted for the root shell.

## Context

Design section 19 names `packages/contracts` as the contract boundary. Decision 0001 left that package empty. TASK 03.C.01 asks for typed client state and API contracts for the selected section, filters, pagination, and user-visible status. Secrets and exchange credentials stay out of client state.

The shell already has seven sections. A refresh returns to Dashboard and does not keep the selected section. The checklist status view already uses `empty`, `loading`, `ready`, and `error`, with counts `PASS`, `FAIL`, `BLOCKED`, and `STALE`. The source names no shell filter fields, no page size, and no page-index origin. No OpenAPI generator version is named.

## Decision

`packages/contracts/src/view-state.mjs` is the runtime contract. `view-state.d.ts` is the type contract. The client state is a closed object: `section`, `filters`, `pagination`, and `status`.

`filters` is valid only when it has no keys. Any filter field, including a symbol or an exchange credential, is rejected. Unknown keys such as `secret`, `credential`, and `apiKey` are rejected. The error text does not include the rejected value.

`pagination.pageIndex` uses 0 for the first page because the existing table did. `pageSize` must be a positive integer supplied by the caller. This shell still supplies the layout fixture 2. There is no maximum page in the source.

`status` accepts only the four user-visible checklist states and the four count names. `canEdit` stays on the server capability path and is not part of client state.

`initialClientViewState` and `refreshClientViewState` both return Dashboard, empty filters, page index 0, and the supplied status. A browser reload mounts that initial state again. Changing the selected section also sets the page index back to 0 because the market table is mounted only while Market is selected. Selecting the current section does not reset the page.

`GET /api/view-state` requires `pageSize` and returns the refresh state for the public empty status. `POST /api/view-state` validates a view state and does not store it. Neither route reads credentials.

## Evidence

`pnpm test:view-state` rejects invalid section, filter, page, page size, and status values, and checks that a secret value is not echoed. `pnpm typecheck` checks the shell and the route against the type contract. `pnpm test:shell` checks that a reload returns to Dashboard and the first table page, and that the view route rejects a secret field and an unknown section.
