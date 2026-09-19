# real-ui-qa

Phase: plan revised | Iteration: 0 of 3
Plan index: `.loop/plan-real-ui-qa.md`

Done: intake · scope survey · plan index + 4 task specs · **re-survey after the
tenant-isolation change (2026-09-19)** and plan revision. No code written — user
chose plan-only.

## Baseline at re-survey — verified, not reported

- `pnpm lint` → clean (`--max-warnings=0`)
- `pnpm typecheck` → clean, 11 packages + 3 apps
- `pnpm test` → **394 passing / 51 files / 0 failing**

A later run below 394 is a regression, not noise.

## What the update changed in this plan

- Task 04 **reduced**: `apps/web/app/quality/ui-qa/page.tsx` already renders
  findings, and `ownedScreenshotWhere` already scopes screenshot reads. The
  remaining gap is rendering screenshots + correcting the "capture is mocked"
  copy.
- Task 02 **gained** two criteria: capture must be cancellable (browser killed,
  no rows written), and every `Screenshot` row needs a `taskId` or `reviewRunId`
  or fail-closed ownership makes it invisible to every tenant.
- Task 01 **gained** a cancellation-race criterion.
- New cross-cutting rule 7: tenant-scoped, fail-closed, from the first commit.

Unchanged and re-verified: `persistUi` still has zero callers · no `UI_QA` in
`WorkflowStepKey` or `STEP_HANDLERS` · Playwright still absent from the worker.

## Open blockers

- B1: repo is **not under git**. The review phase reads a diff; without a
  baseline there is nothing to diff and no rollback. Resolve before task 01.
- B2: Q1 execution model (in-process / subprocess / deferred) — blocks task 02.
- B3: Q2 who starts the app under test — blocks task 02.
- B4: Q3 screenshot storage (base64 vs object storage) — blocks task 02.

Resolved this round: none. B1–B4 all still open.

Next: user answers B1 and Q1–Q3, then run the loop on `01-ui-qa-step` — its
dependencies are satisfied and it is not blocked by Q1–Q3.
