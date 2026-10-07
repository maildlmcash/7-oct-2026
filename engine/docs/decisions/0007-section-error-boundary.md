# 0007 — Section error boundary and correlation id

Status: accepted for the root shell.

## Context

TASK 03.C.02 asks for section-level error boundaries and request correlation IDs so one failed panel does not blank the shell. Diagnostic metadata must stay actionable and must not carry personal secrets.

The shell already renders seven sections on one pathname. `packages/ui-kit` already has `ErrorState`. `GET /api/view-state` and `POST /api/checklist-owner` already exist. The source names no correlation header, no identifier charset, and no redaction list. Design page 14 calls the check-run field a trace ID. OpenTelemetry, route and view capture, and the later request-log fields belong to later tasks.

## Decision

`apps/web/request-correlation.mjs` resolves the correlation id. The response header is `x-correlation-id`. That name is an implementation choice. An inbound value is echoed only when it is a canonical hexadecimal UUID. Any other value, including a secret, is replaced with `crypto.randomUUID()` and is not written into the response.

`x-shell-section` is sent by the shell only as one of the seven section names. A diagnostic stores the section only when it is one of those names. The event object has only `correlationId`, `section`, `route`, and `httpStatus`. Free text, response bodies, cookies, and authorization values are not fields. Page and API health fields are decided in 0014. This four-field diagnostic stays unchanged.

`SectionErrorBoundary` wraps the panel body and is keyed by the selected section. The section navigation and the heading stay outside it. A render failure shows `ErrorState` inside the panel. `SectionRequest` loads `GET /api/view-state?pageSize=2` for the current section. A failed response adds the error alert and leaves the section content mounted. A successful response does not change the client view state.

Both existing routes set `x-correlation-id`. The view-state JSON adds `correlationId` beside the existing validation result. The checklist-owner JSON stays the role-scope body. Neither route stores the request or reads credentials. The view-state response also sends `cache-control: no-store` so a correlation id is not reused from the browser cache.

## Evidence

`pnpm test:request-correlation` checks UUID echo, secret replacement, section names, and the four diagnostic fields. `pnpm test:shell` injects an HTTP 500 for `/api/view-state` and checks the local alert, the diagnostic event, the remaining shell, and the checklist-owner status bodies. A render throw is limited to Dashboard. `pnpm typecheck` checks the shell and the routes.
