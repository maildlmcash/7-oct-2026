# 0008 — Project checklist and evidence tracker

Status: accepted for task 1.C.2.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/features/checklists/`, `services/control-api/src/checklists/`, and `data/migrations/`. This tree has no `apps/control-web/` directory and no `services/control-api/` directory. ADR 0002 keeps the shell in `apps/web`. ADR 0005 keeps control evaluation in `services/`.

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/features/checklists/` | `apps/web/app/features/checklists/` |
| `services/control-api/src/checklists/` | `services/checklists/` |
| `data/migrations/` | `data/migrations/0015_project_checklist.sql` |

Paths above are relative to `engine/`. Migrations `0001` through `0005` and `services/checklist-status.mjs` stay as they are. Their status list remains `NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, and `NOT_APPLICABLE`. This task does not alias `TODO` to `NOT_STARTED`.

## Decision

1. Project checks are a separate versioned table. An edit inserts the next version. Older versions stay. The fields are owner, due date, evidence link, status, and blocking dependency, plus reviewer and review timestamp.
2. Templates are web, API, data, scoring, paper engine, iOS, and Android. Status values are `TODO`, `IN_PROGRESS`, `PASS`, `FAIL`, and `BLOCKED`.
3. `PASS` is rejected unless the new version has an evidence link, a reviewer, and a review timestamp. A downstream check cannot move to `IN_PROGRESS` or `PASS` while its dependency is `BLOCKED`.
4. A monitored error event opens one issue. The stored fields are correlation id, section, route, HTTP status, and timestamp. The same correlation id does not open a second issue. The issue status is `TODO`.
5. The running screen reads and writes `GET` and `POST /api/project-checklist`. The desk session is the actor. A client role field is ignored. User and signed-out callers cannot write. The desk login store and the checklist store are one process store, so separate route bundles see the same login and the same versions. This machine has no PostgreSQL server, so the migration is proven in process. A page reload on that process keeps the saved version.

## Non-claims

- No exchange credential, wallet key, or live order is stored.
- No LIVE market status is added.
- Catalog grant lists stay empty. `/api/checklist-owner` is unchanged.
- The screen fixture is MOCK.

## Evidence

- `tests/project-checklist.mjs`
- `apps/web/tests/project-checklist.spec.ts`
- `docs/architecture/evidence/1-c-2/`
