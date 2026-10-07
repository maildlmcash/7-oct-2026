# Admin checklist — phase 01 baseline

This is the checklist record for the phase 01 baseline. The Admin checklist application is not built. Owner and reviewer are UNKNOWN.

## Checklist item

- Area: phase 01 baseline
- Requirement: deterministic health smoke and an architecture decision record
- Test method: `pnpm health`
- Expected value: `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`
- Environment: local
- Build SHA parent: `107ae614a0ba19bd8826a405a537df3f62501ce9`
- Record commit: the commit that adds this file
- Owner: UNKNOWN
- Reviewer: UNKNOWN
- Dependencies: `apps/web/health.mjs`. No external service.
- Observed value: `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}` then `health smoke ok`
- Result: PASS. Two local runs exited 0 and printed the same bytes.

## Attached baseline report

The path-verified baseline is `docs/dependency-map.md`.

Approved boundaries and deferred choices are in `docs/decisions/0001-approved-boundaries.md`.

The current source has one application boundary, `apps/web`. Exchange input, normalization, scoring, prediction, and paper-book output have no call sites. No provider client is imported. Section 19 service directories are absent. Rust workers are absent.

Task 01.A.01 remains BLOCKED and accepted. This checklist item does not mark phase 01 complete.
