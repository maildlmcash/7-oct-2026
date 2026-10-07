# 0017 — Diagnostic bundles

Status: accepted for findings in the in-memory log.

## Context

TASK 05.B.02 asks a finding to carry a trace, a screenshot, sanitized request metadata, reproduction steps, and relevant logs. Root-cause text is a hypothesis with confidence, not a verified fact. The bundle must be enough to reproduce the test finding, and a scan must show that secrets and PII were removed.

The `finding` table already has `suspected_cause`, `confidence`, and `trace_repro`. Evidence is a URL. Design page 15 forbids password, OTP, API secret, private key, seed phrase, and access token in logs and screenshots. It also says the system does not decide a root cause by itself. The source names no confidence scale. Decision 0016 already keeps severity null for that reason.

## Decision

`services/diagnostic-bundle.mjs` attaches one bundle to an existing finding. The bundle holds the fingerprint, seen time, build, trace request id, screenshot URL, request method, route, request id, and HTTP status, generated steps, allow-listed log lines, and a hypothesis. The hypothesis label is `hypothesis`. `verified` is false. `confidence` stays null. Caller text that says the cause is verified is not stored as fact.

Request headers, bodies, form fields, stacks, and secret-named values are not copied. A screenshot URL must be `http`, `https`, or `file`, with no user info and no secret query key. Log lines keep a request id, a closed route, an HTTP status, and a result that passes the scan. Email addresses, bearer values, private-key blocks, and seed-phrase text fail the scan. A later occurrence keeps the same bundle object.

`reproduceFromBundle` rebuilds the page-health or layout signal from the bundle. The service does not insert into `finding` or `evidence` and does not read live trading flags.

## Evidence

`pnpm test:diagnostic-bundle` covers a page-health bundle whose reproduction matches the fingerprint, a layout bundle, and scanner failures for a password key, an email, a bearer value, and a private-key block.
