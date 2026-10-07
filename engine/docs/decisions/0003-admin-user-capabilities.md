# 0003 — Admin and user capabilities

Status: accepted for the root shell.

## Context

Design section 23 says Admin is a secured section of the same shell. Role may filter navigation and data. Every write still needs a server-side permission check. Hiding a control is not authorization.

TASK 02.C.02 already lets a Customer of the same tenant read checklist status and lets an Admin of that tenant edit an owner. Other named roles are denied. There is no session yet.

## Decision

`services/shell-capabilities.mjs` is the server capability source. A same-tenant Admin receives the checklist edit control. A same-tenant Customer receives the user checklist view and the market view as separate sections. The other roles receive neither.

`writeChecklistOwner` checks a server-supplied actor again. A client flag such as `editChecklist: true` does not grant the write. The published page has no actor, so it does not render the edit control. `POST /api/checklist-owner` no longer accepts that actor from the client. Decision 0010 records the principal check.

## Evidence

`pnpm test:shell-capabilities` checks the rendered control set for each named role and rejects direct writes. `pnpm test:shell` checks that the published page has no edit control. Decision 0010 records the HTTP results.
