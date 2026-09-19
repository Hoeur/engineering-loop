# 02 — Playwright screenshot capture service

**Plan:** `.loop/plan-real-ui-qa.md` · **Depends on:** 01 · **Status:** blocked on Q1–Q3

## Problem

The `UI_QA` step from task 01 runs against mock output. This task makes it real:
drive Playwright against the running app, capture one screenshot per viewport per
page, collect console errors and failed network requests, and persist them as
`Screenshot` rows. `@playwright/test@1.55.1` is currently a dependency of
`apps/web` only — the worker, the only process allowed to execute anything, does
not have it.

## Blocked — answer first

Do not start until Q1 (execution model), Q2 (who starts the app under test) and
Q3 (screenshot storage) in the plan are answered. Each changes the design, and
guessing here produces a service that has to be rewritten rather than reviewed.

## Acceptance criteria

- [ ] A capture service exists in `apps/worker/src/services/` (sibling of
      `test-runner.ts`) exposing a typed method that takes a URL plus a page list
      and returns captures for all three viewports.
- [ ] Captures use `VIEWPORT_PRESETS` verbatim — 1440×900, 768×1024, 375×812
      (`packages/types/src/enums.ts:251`). Asserted by a test, not by eye.
- [ ] Each capture writes a `Screenshot` row with `page`, `viewport`, `width`,
      `height`, `storagePath`, and populated `consoleErrors` / `failedRequests`.
- [ ] Console errors and failed requests are captured from the real page, and a
      test proves a page that logs an error and 404s a request produces a row with
      both arrays non-empty.
- [ ] **The worker verifies its own output.** The step asserts the screenshot
      files exist and are non-empty by reading them, and does not trust any
      reported success. A capture that claims success but produced no file fails
      the step.
- [ ] Failure modes degrade, never crash the task: app unreachable, navigation
      timeout, browser binary missing, or a single page failing among several —
      each records a diagnostic and the step still returns a usable result.
- [ ] Timeouts and a total capture budget are enforced, consistent with the
      existing execution-timeout model.
- [ ] **Capture is cancellable.** A browser is a long-running child process, so
      it must observe the cancellation semantics added in
      `apps/worker/src/services/agent-executor.ts` and `workflow-engine.ts`: when
      cancellation wins, the browser is killed, no `Screenshot` rows are written,
      and no result is persisted. Test it the way
      `workflow-engine.integrity.spec.ts` tests the step-result race.
- [ ] Every `Screenshot` row is written with a `taskId` or a `reviewRunId`.
      `ownedScreenshotWhere` (`apps/api/src/common/tenant-ownership.ts:170`) is
      fail-closed and will make an ownerless row invisible to every tenant —
      silently orphaned data, not an error. Asserted by a test.
- [ ] If Playwright runs as a subprocess (Q1b), the executable is added to the
      command runner allowlist explicitly — `packages/git/src/command-runner.ts:87`
      refuses anything outside it — and that addition is called out for review as a
      security-relevant change.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.

## Constraints

- Capture runs in the **worker**. The API may not spawn processes or touch a
  working copy.
- Browser binaries are large; state clearly how they are provisioned for
  `docker/` images and whether install is required at build or runtime.
- Nothing here may name a model vendor — this is browser automation, not an agent
  provider.
- Untrusted-execution posture still applies: the app under test is repository
  code, so a captured page is untrusted content.

## Out of scope

Sandboxing the browser (roadmap #1) · object storage migration unless Q3 chose it ·
visual regression baselines · feeding the reviewer (task 03).

## Notes

The riskiest task in the plan. If Q1 resolves to (c) — defer until sandboxing —
say so and stop; do not build a half-sandboxed version to keep momentum.
