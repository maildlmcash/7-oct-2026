# 0019 — Release gate

Status: accepted for an in-memory release check.

## Context

TASK 05.C.02 asks critical checklist failures to block a release through a configurable threshold. A proposed fix must not be edited into the code or deployed. After approved remediation and a rerun, the gate passes and the decision stays in an audit record.

Checklist statuses already include `FAIL` and `BLOCKED`. Same-tenant Admin is the only checklist editor. Decision 0018 keeps finding severity null because the source names no severity scale. The source also names no numeric release threshold and no deploy command. Design page 15 says not to auto-edit or auto-deploy a fix.

## Decision

`services/release-gate.mjs` evaluates one release at a time. The threshold is the caller-supplied list of checklist statuses that block. A missing or empty list fails closed with `release threshold is not configured`. A status outside the checklist set is rejected. The test fixture uses `FAIL` and `BLOCKED`. That pair is not a source count.

An open finding whose status is in the list blocks the release. The reason is `critical checklist failure`. Approved remediation is the existing Admin triage to `PASS` or `NOT_APPLICABLE` with remediation evidence. The gate then stays blocked until a rerun records a non-blocking result with that same evidence URL. The passing reason is `release gate passed`.

Every evaluation appends one frozen audit row: actor, action `release-gate`, target, reason, result, changedAt, and `configChecksum: null`. The row records `edited: false` and `deployed: false`. The gate does not write source files, does not deploy, and does not read live trading flags. A caller patch or deploy flag is ignored. A denied actor writes no audit row.

## Evidence

`pnpm test:release-gate` covers an unconfigured threshold, a synthetic `FAIL` finding that blocks, a pass after Admin remediation and a rerun, the unchanged first audit row, and a denied Customer.
