# 0004 — Responsive layout primitives

Status: accepted for the root shell.

## Context

Design section 19 names `packages/ui-kit` as the accessible common components. Decision 0001 left that package as a name with no source. TASK 03.B.01 is the task that adds the first source.

The task asks for responsive navigation, headings, panels, tables, modals, and empty, loading, and error states, using the current design system. It also asks that large market tables stay virtualized or paginated, and that common mobile, tablet, and desktop widths show no overlap or horizontal overflow.

The source does not list color, type, or spacing tokens. The source names the three viewport classes and does not list pixel widths or a table page size. No virtualization library or version is named.

## Decision

`packages/ui-kit` exports structural primitives: section navigation, a level-1 heading, a panel, a paginated table, a native dialog, and empty, loading, and error states. The stylesheet sets wrapping, fixed table layout, and dialog bounds. It does not invent a brand palette. Task 1.A.3 adds tokenized gallery primitives in `src/tokens.css` (stale, restricted, badges, cards, fields, and a chart container). Those tokens do not replace this file or `apps/web/app/styles.css`.

The shell keeps one pathname and the seven section buttons. The published page still has no actor, so it still has no checklist edit control and no market view. The Market section renders the paginated table with layout-fixture labels. Those labels are not prices. The page size is a caller argument. This shell passes 2 so the fixture can prove that later rows stay out of the document. A non-positive page size renders no body rows.

Pagination is the chosen bound. A virtualization package is not added.

## Evidence

`pnpm test:shell` includes `apps/web/tests/layout.spec.ts`. The pixel sizes in that file are fixtures: mobile 375×667, tablet 768×1024, and desktop 1280×800. They are not source requirements. The test checks document overflow, nav and panel overlap, dialog containment, Escape, and that a five-row fixture with page size 2 shows two body rows at a time.
