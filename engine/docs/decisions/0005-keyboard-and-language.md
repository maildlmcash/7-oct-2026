# 0005 — Keyboard and language behavior

Status: accepted for the root shell.

## Context

TASK 03.B.02 asks for keyboard navigation, focus management, labels, contrast checks, and Hindi, English, and Urdu text. Urdu must lay out right to left. Hindi must shape. Business logic stays as it is.

Design section 23 keeps one pathname and the seven section names. Design page 14 names keyboard and contrast as browser checks and asks for screenshots. The source does not name a color theme, a contrast ratio, a font file, or translated section titles.

## Decision

The shell adds a labelled language group for English, Hindi, and Urdu. The tags `en`, `hi`, and `ur` are the BCP 47 tags for those three named languages. English and Hindi set `dir=ltr`. Urdu sets `dir=rtl` on the document and on the sample. Choosing a language does not change the section, the pathname, or the capability checks.

Section buttons stay the canonical English names. The language sample is fixture text, not market or checklist data. Hindi uses `हिंदी` and `अक्षर` so the short-i matra and the `क्ष` conjunct have to shape. Urdu uses `اردو` and `نمونہ`.

Focus uses the browser `:focus-visible` outline in `currentColor`. Text and controls use the user-agent `Canvas` and `CanvasText` colors because the source names no palette. The contrast check measures the rendered colors and fails when text and background are the same. It does not apply a ratio the source does not give.

A reload clears the language choice with the section choice. Neither is stored in history.

The supported matrix in this task is the three named languages on the one current presentation. No second theme was added.

## Evidence

`pnpm test:shell` runs `apps/web/tests/language.spec.ts` with the existing shell and layout tests. Screenshots, measured contrast, and the failure list are written to `docs/evidence/03-b-02/`. The passing run measured contrast ratio 21 for the sampled text against `Canvas` / `CanvasText`. `result.json` records `failures` as an empty list.

There is no live checklist row for this task. The shell still has no session and no database connection, so these evidence files are the checklist evidence attachment. A passing run does not keep a stale failure screenshot.
