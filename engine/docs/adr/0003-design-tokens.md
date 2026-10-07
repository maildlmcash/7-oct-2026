# 0003 — Design tokens and component states

Status: accepted for task 1.A.3.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `packages/ui/` and `apps/control-web/src/styles/`. Those directories are not in this repository. Task 1.A.1 maps shared UI to `engine/packages/ui-kit` and the product app to `engine/apps/web`. This task does not create a second package or a second SPA.

| Manual path | File edited |
| --- | --- |
| `packages/ui/` | `packages/ui-kit/src/tokens.css`, `packages/ui-kit/src/layout.tsx`, `packages/ui-kit/src/index.ts` |
| `apps/control-web/src/styles/` | `apps/web/app/styles/tokens.css` (imports the package tokens) |

Paths above are relative to `engine/`.

The gallery route `apps/web/app/gallery/page.tsx` is the tested screen for this task. It is not a shell section. Ordinary shell navigation still stays on `/app`.

## Decision

1. Tokens cover color, typography, spacing, focus, and density. Light is the default. Dark follows `prefers-color-scheme` unless the gallery sets `data-theme="light"`. Compact density only reduces spacing. Body text stays 16px. Focus is a 3px outline.
2. Shared primitives gain stale and restricted states, status badges, cards, a labeled text field, and a chart container. Tables and dialogs already exist and the gallery uses them. The chart container draws no series.
3. Badge and state names are Loading, Empty, Stale, Error, and Restricted. They are fixtures. They are not a live market status.
4. `apps/web/app/styles.css` and the shell route stay as they are. Decision 0004 still owns the structural shell stylesheet.

## Non-claims

- No order, secret, or wallet path is added.
- No LIVE market status is added.
- `pnpm typecheck` is still blocked by `app/cex-desk.tsx` TS7006 (blocker B2). This task does not claim that command is green.

## Evidence

- `apps/web/tests/ui-gallery.spec.ts`
- `tests/ui-tokens.mjs`
- `docs/architecture/evidence/1-a-3/`
