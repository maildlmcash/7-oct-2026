# 0002 — Single URL shell

Status: accepted for the root application shell.

## Context

Design section 23 says the app opens one root URL. Dashboard, Market, Predictions, Search, Checklist, Bugs, and Admin are separate sections. The section changes through client view state. The browser pathname does not change, and the change is not a full-page reload.

The same section says the trade-off: after a refresh, the section returns to the default. The source does not give a second name for that default. This shell uses Dashboard, the first section in that list.

`apps/web/app/page.tsx` is the only page. `apps/web/app/shell.tsx` holds the section state.

## Decision

Section buttons update React state. They are not links, and the shell does not call `history.pushState` or `history.replaceState`.

The pathname stays the pathname of the root page. A reload shows Dashboard. Checklist still renders the empty checklist status view from TASK 02.C.02. Admin is a section heading in this shell. Role filtering of that section is not part of this decision.

## Back and forward

Section buttons do not add history entries. Browser back does not select an earlier section. In the Playwright run, back leaves the shell document and returns to the previous document, `about:blank`. Forward opens the root pathname again and shows Dashboard. A reload also shows Dashboard. The selected section is not restored.

## Evidence

`pnpm test:shell` uses Playwright. It opens each section, checks the root pathname, checks that the document was not reloaded, checks that history length stays the same, and checks that back and forward do not change the selected section. It then reloads and checks that the heading is Dashboard.

The source does not name a Playwright version. `@playwright/test` 1.63.0 has no macOS 12 browser build. This machine is macOS 12.7.6, so the runner is `@playwright/test` 1.49.1, which still installs Chromium here. Next.js 16.3.8 declares a peer of `@playwright/test` `^1.51.1`. That peer is not the runner used for this test.
