# 0013 — Rate limits and abuse controls

Status: accepted for the web process.

## Context

TASK 04.C.02 asks for tested rate limits on login, reset, resend, and sensitive reads, plus counters and alerts that do not contain passwords, OTPs, or raw tokens.

Reset and resend already throttle in `services/session.mjs`. Decision 0009 left login throttles, counter exposure, and alerts for this task. Design page 15 forbids password, OTP, and token values in logs. The source names no cap, window, status code, or counter route.

## Decision

Login, reset, resend, and sensitive reads share `accountLimit`, `ipLimit`, and `windowMs` on the session policy. `sessionRuntime` keeps those fields null. Login and a successful sensitive read fail closed until a test or a later policy sets them. Reset and resend already fail closed. Tests pass fixture values. Those fixtures are not a product cap.

Login counts a request only after the CSRF challenge succeeds. The buckets are `login:account` and `login:ip`, keyed by a SHA-256 digest. A missing client address does not issue a session. The public body stays `login denied`. The session log and the alert record `throttled`. Reset and resend keep the same public body as decision 0009 and add the same alert. The address is still read from `x-client-ip`.

`GET /api/session` and an authorized `checklist.read` are the sensitive reads. Authentication and authorization still run first, so a missing or rejected session stays `login denied` or `role scope denied`. The read buckets are `read:subject` and `read:ip`. The subject bucket uses `accountLimit`. The address bucket uses `ipLimit`. The source names no separate read cap. A denied read returns HTTP 429 and `rate limit denied`, and it does not return the session body. 429 is an implementation choice. View state, health, CSRF, logout, rotation, and `checklist.write` are not read limits.

`rateLimitCounters` returns `action`, `scope`, `count`, and `windowStart`. It does not return the digest, login id, address, password, OTP, or token. `GET /api/session/limits` requires the session cookie and is itself a sensitive read. It returns those counters and the caller's throttle alerts. An alert has only `action`, `result`, `subjectId`, and a UUID `correlationId`. `result` is `throttled`. A null or other subject's alert is not included. The process list can hold every safe alert; the route shows the caller only. No admin grant is added.

The window reopens when `now` reaches `windowStart + windowMs`. The bucket that crossed its limit stays at that count until then. Live trading stays off.

## Evidence

`pnpm test:abuse-controls` covers login and read bursts, the recovery window, reset and resend alerts, the limits route, and redaction. `pnpm test:session`, `pnpm test:recovery`, `pnpm test:access-policy`, and `pnpm test:privileged-access` cover the existing flows with fixture caps. `pnpm typecheck` checks the route. `pnpm health` checks the locked trading contract.
