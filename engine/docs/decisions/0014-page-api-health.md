# 0014 — Page and API health events

Status: accepted for the web process.

## Context

TASK 05.A.01 asks missing pages and failed API calls to record a route or view id, HTTP status, JavaScript exception, request id, build SHA, and environment. The event must not carry passwords, tokens, or unrestricted form data.

Decision 0007 already stores `correlationId`, `section`, `route`, and `httpStatus` on the shell diagnostic. That object stays unchanged. The env examples name `APP_ENV` as `local`, `test`, or `staging`. They name no web build SHA. OpenTelemetry is not added.

## Decision

`apps/web/page-health.mjs` builds one frozen event. The fields are `routeViewId`, `viewId`, `httpStatus`, `exception`, `requestId`, `buildSha`, and `environment`. `requestId` reuses the correlation UUID. Any other inbound id is replaced and is not stored.

`routeViewId` is one of the existing API routes, `section-render`, or `missing-page`. `viewId` is one of the seven section names or `missing-page`. A raw path, query, or secret is dropped. `httpStatus` is an integer from 100 through 599, or null. `exception` is `js-exception` when a caller reports an exception, and null otherwise. The error message and stack are not fields.

`buildSha` stays null. The source names no web build SHA. A test may pass a hex fixture of 7 to 64 digits. Any other value, including a password, is dropped. `environment` is `local`, `test`, or `staging` from `APP_ENV`. Any other value is null. `LIVE_TRADING` and `LIVE_ORDERS_LOCKED` are not read from the environment.

Failed session, view-state, and checklist responses record an event when the status is 400 or higher. `apps/web/app/not-found.tsx` records `missing-page` with status 404 and shows the request id. It does not show the requested path. A section render exception and a failed view-state fetch record the same event on the client. A successful response does not record one. Live trading stays off.

## Evidence

`pnpm test:page-health` covers an injected missing page, 4xx, 5xx, a JavaScript exception, and secret redaction. `pnpm test:request-correlation` covers the unchanged four-field diagnostic. `pnpm typecheck` checks the routes. `pnpm health` checks the locked trading contract.
