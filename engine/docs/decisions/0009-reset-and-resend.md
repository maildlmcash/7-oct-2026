# 0009 — Password reset and OTP resend

Status: accepted for the web process.

## Context

TASK 04.A.02 asks for password reset and OTP resend with per-account and per-IP throttles, single-use short-lived tokens, enumeration-resistant responses, and audit events. Secrets must be redacted.

`services/session.mjs` already stores account passwords as scrypt hashes and keeps session secrets out of its log. Design page 15 names a resend cooldown, a rate cap, and a delivery callback, and it forbids OTP and password values in logs. The source names no lifetime, cap, window, OTP alphabet, IP header, or delivery provider. TASK 04.C.02 later exposes rate-limit counters and alerts. This task does not add those.

## Decision

Reset and resend stay on the session store. `POST /api/session/reset` and `POST /api/session/resend` require the existing CSRF challenge. A known account and an unknown account receive the same public body. A throttled request receives that same body. The audit event records `throttled`, `expired`, `replayed`, `denied`, `ok`, or `unconfigured`.

The audit object has only `action`, `result`, `subjectId`, and a UUID `correlationId`. It does not store the password, OTP, reset token, login id, or IP. The raw token is given only to the in-process delivery callback. No delivery provider is named, so the callback is that list.

Tokens are 32-byte secrets stored as SHA-256 hashes. That size is an implementation choice because the source names no OTP length. A new reset or resend marks the previous open token of that kind used. Confirming a reset changes the password hash and revokes that account's sessions. Confirming an OTP does not create a session.

The source names no cap or lifetime. `sessionRuntime` keeps `resetTtlMs`, `resendTtlMs`, `accountLimit`, `ipLimit`, and `windowMs` null, and those routes fail closed. Tests pass fixture values. The IP is read from `x-client-ip`. That header is an implementation choice. Login throttles, counter APIs, and alerts are decided in 0013.

## Evidence

`pnpm test:recovery` covers expiry, replay, account throttles, IP throttles, enumeration, redaction, and session revocation after reset. `pnpm test:session` covers the existing session flow. `pnpm typecheck` checks the routes.
