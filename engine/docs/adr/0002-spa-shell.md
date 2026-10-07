# 0002 — SPA shell route invariant

Status: accepted for task 1.A.2. This supersedes the history sentence in `docs/decisions/0002-single-url-shell.md`. A reload still returns to Dashboard.

Task: 1.A.2 Build the SPA shell and route invariant.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/app/` and `apps/control-web/src/shell/`. Those directories are not in this repository. Task 1.A.1 forbids a second SPA. This task edits the existing shell:

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/shell/` | `apps/web/app/shell.tsx` |
| `apps/control-web/src/app/` | `apps/web/app/shell-page.tsx`, `apps/web/app/page.tsx`, `apps/web/app/app/page.tsx` |
| route config for `/app` | `apps/web/next.config.ts` redirect from `/` to `/app` |

Paths above are relative to `engine/`.

## Decision

1. One shell renders every section. Ordinary section changes update client state and `history.pushState`. The pathname string is not changed.
2. The canonical pathname is `/app`. `/` redirects there. Section buttons are not links.
3. The first history entry stores `{ shellSection: "Dashboard" }` with `replaceState`. Back and forward read that state and select the section. They do not leave the document.
4. A reload does not read the history state. The view contract still opens Dashboard.
5. Chrome is a header, a breadcrumb navigation, the existing section navigation, and a main landmark. Breadcrumb items are text, so they do not take keyboard focus ahead of the language controls.
6. Button transitions are removed when `prefers-reduced-motion: reduce` is set. Focus-visible outline stays at least 2px.

## Non-claims

- No LIVE market status is added.
- No order, secret, or wallet path is added.
- Role filtering is unchanged.
- The pre-existing `app/cex-desk.tsx` TS7006 failure is blocker B2 from task 1.A.1. This task does not claim `pnpm typecheck` is green.

## Evidence

- `apps/web/tests/shell-route.spec.ts`
- `docs/architecture/evidence/1-a-2/`
