# 0008 — Session lifecycle

Status: accepted for the web process.

## Context

TASK 04.A.01 asks for the repository's approved authentication flow: secure cookies, CSRF protection where applicable, expiry, revocation, and session rotation. Live trading stays disabled. Tokens must not appear in logs.

Design section 18 names the web stack. Design section 19 names auth inside a FastAPI control API and users in PostgreSQL. Decision 0001 keeps the implemented boundary at `apps/web` and defers that service. The shell has no session. The source names no session lifetime, cookie name, SameSite value, CSRF header, or password KDF. Password reset and OTP resend are TASK 04.A.02. Role policy is a later task.

## Decision

`services/session.mjs` is the session lifecycle. `apps/web/session-http.mjs` turns it into cookie responses. The routes are `GET /api/session/csrf`, `POST /api/session/login`, `GET /api/session`, `POST /api/session/logout`, and `POST /api/session/rotate`.

The session cookie name is `__Host-session`. That prefix is an implementation choice. The cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`, with no `Domain`. The session secret is only in that cookie. The response JSON does not include it.

A state-changing request must send `x-csrf-token`. That header name is an implementation choice. Login consumes a one-time challenge. Logout and rotation require the token issued for the current session. A new login revokes the presented session only after the password matches.

The source names no lifetime. `sessionRuntime.policy.ttlMs` is null, and login, CSRF, and rotation fail closed with no cookie. Tests pass an explicit fixture lifetime. Expiry is `now >= expiresAt`. Logout and `revokeSession` set `revokedAt`. Rotation revokes the old record and issues a new cookie and CSRF token.

Passwords are stored as scrypt hashes with Node's built-in parameters `N=16384`, `r=8`, `p=1`. Those parameters are an implementation choice. The account record has no password field. The log allows only `action`, `result`, `sessionPublicId`, and a UUID `correlationId`.

The session result reads `liveTrading` and `liveOrdersLocked` from `apps/web/health.mjs`. A client field cannot change them. The store is process memory. No session table was named, so this task adds no migration. Checklist authorization is unchanged.

## Evidence

`pnpm test:session` covers login, logout, expiry, revocation, rotation, cookie flags, fail-closed lifetime, and the log. `pnpm health` still prints the locked trading contract. `pnpm typecheck` checks the routes.
