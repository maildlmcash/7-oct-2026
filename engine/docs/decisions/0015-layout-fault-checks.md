# 0015 — Layout fault checks

Status: accepted for isolated layout measurements.

## Context

TASK 05.A.02 asks for isolated checks for overlap, overflow, missing headings, broken links, and mobile viewport failures. iOS and Android device runs stay distinct from web runs. A known fixture must be detected with viewport and device metadata. A false positive can be triaged without deleting the raw finding.

Decision 0004 already checks the shell at the mobile, tablet, and desktop fixture viewports and expects no overlap or horizontal overflow. Those pixel sizes are not source requirements. The checklist areas already name `website`, `mobile iOS`, and `mobile Android` as separate values, and reject a combined `mobile` value.

The source names no device lab, screenshot tool, or hardware pixel size for iOS or Android.

## Decision

`services/layout-faults.mjs` inspects one measurement at a time. The surface is `website`, `mobile iOS`, or `mobile Android`. A combined `mobile` surface is rejected with the existing checklist error. Any other surface is rejected. Each finding copies that surface and the caller-supplied viewport name, width, and height.

Overlap uses the same 1px gap as `apps/web/tests/layout.spec.ts`. Overflow is `scrollWidth` greater than `clientWidth`. A missing heading is an expected heading string that is absent. A broken link is a missing href or an integer status from 400 through 599. The href is not stored. A mobile viewport failure is a box outside the viewport, using the same 1px allowance as the layout dialog check, and only when the viewport name is `mobile`.

Findings are append-only. Triage appends a `false-positive` note and does not remove or rewrite the finding. There is no delete operation. The checker does not fetch URLs and does not read live trading flags. `apps/web/tests/layout.spec.ts` stays the shell check.

## Evidence

`pnpm test:layout-faults` covers the five injected faults, separate iOS and Android runs, and triage that leaves the raw finding in place.
