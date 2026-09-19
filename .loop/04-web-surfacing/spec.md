# 04 — Surface UI findings and screenshots in the web UI

**Plan:** `.loop/plan-real-ui-qa.md` · **Depends on:** 03 · **Status:** not started
**Revised:** 2026-09-19 re-survey — scope reduced, see below.

## Problem

Tasks 01–03 produce `Screenshot` rows and `ReviewFinding` rows with
`category: 'UI'`, `uiCategory`, `viewport` and `screenshotId`. The findings side
is already rendered; **screenshots are not shown anywhere**, and the page
currently tells the user capture is mocked. This task surfaces the images and
corrects the copy.

## What already exists — do not rebuild

- `apps/web/app/quality/ui-qa/page.tsx` renders `VIEWPORT_PRESETS` and a
  `FindingsScreen` over `['UI', 'ACCESSIBILITY']`. UI findings already reach the
  user through it.
- `ownedScreenshotWhere` (`apps/api/src/common/tenant-ownership.ts:170`) already
  scopes screenshot reads, and `reviews.service.ts:86` already calls it.

So the real gap is narrower than "surface UI QA": render the **screenshots**,
tie them to their findings, and fix the now-false "capture is mocked" paragraph.

## Acceptance criteria

- [ ] The API exposes screenshots for a task through `ownedScreenshotWhere` —
      the existing builder, not a new filter — following the existing envelope
      and Zod contract conventions in `packages/schemas`.
- [ ] A cross-tenant screenshot id returns NOT_FOUND, asserted by a test in the
      style of `tenant-isolation.services.spec.ts`.
- [ ] The "Screenshot capture is mocked in this MVP" paragraph in
      `apps/web/app/quality/ui-qa/page.tsx:25-27` is corrected — it is false once
      task 02 ships, and a stale claim in the UI is a defect.
- [ ] Task detail renders UI findings grouped by viewport, each showing severity,
      `uiCategory`, page, problem and required fix.
- [ ] A finding with a `screenshotId` shows its screenshot; the three viewports
      are distinguishable at a glance.
- [ ] A task with no UI QA run shows nothing new — no empty panel, no error, no
      layout shift. Asserted by a test.
- [ ] The live run view shows the `UI_QA` step alongside the existing steps,
      including its SKIPPED state.
- [ ] Screenshots render from whatever storage Q3 selected, without blocking page
      load on large base64 payloads.
- [ ] Playwright e2e in `apps/web/e2e` covers the new surface at the project's
      existing viewport matrix.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass.

## Constraints

- Follow `.ai/ui-guidelines.md` and the `packages/ui` design-system primitives;
  do not introduce a parallel component set.
- A page or problem string originates from repository content and agent output —
  render it as text, never as HTML.
- The API reads; it does not execute. No capture triggering from the API.

## Out of scope

Re-running UI QA from the UI · a screenshot gallery outside task detail · visual
diffing · exporting findings.

## Notes

`Screenshot.dataUri` exists specifically so images render without object storage.
If Q3 kept base64 in Postgres, watch the payload size on a task with several pages
× three viewports — that is the likeliest performance problem here.
