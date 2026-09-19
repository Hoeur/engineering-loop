# 01 — UI_QA workflow step

**Plan:** `.loop/plan-real-ui-qa.md` · **Depends on:** nothing · **Status:** not started

## Problem

`ReviewEngine.persistUi()` (`apps/worker/src/services/review-engine.ts:93`) has no
callers. The schemas, the `Screenshot` model and the `UI_REVIEWER` role all exist,
but `WorkflowStepKey` has twelve keys and none of them is a UI step, so nothing in
`STEP_HANDLERS` can reach that code. This task adds the missing step and places it
in the router — the seam every later task plugs into. It deliberately does **not**
capture screenshots; it proves the path with mock provider output.

## Acceptance criteria

- [ ] `WorkflowStepKey.UI_QA` exists in `packages/types/src/enums.ts` and appears
      in `STEP_HANDLERS` (`apps/worker/src/workflow/steps/index.ts`).
- [ ] A task whose project has UI QA **disabled or unconfigured** reaches
      `COMPLETED` with the UI step recorded as `RunStatus.SKIPPED` — not FAILED,
      not silently absent. Asserted by a unit test.
- [ ] A task with UI QA **enabled** runs the step, calls `persistUi`, and writes
      `ReviewFinding` rows with `category: 'UI'` and a non-null `uiCategory`.
      Asserted by a test using the mock provider.
- [ ] `decideEngineeringStep` remains a pure function: no IO, no `Date.now()`, no
      randomness. The existing termination test still passes, and a new test
      drives an enabled-UI-QA task to completion and fails if the loop does not
      terminate.
- [ ] Blocking UI findings (CRITICAL/HIGH) route to `FIX` and are handed to the
      implementer via the existing `openFindings` path; non-blocking ones do not
      re-open the loop.
- [ ] A UI-blocked task that exhausts its review cycles lands in
      `NEEDS_HUMAN_REVIEW`, matching the existing review loop's behaviour.
- [ ] A `UI_QA` step observes the cancellation semantics added in
      `workflow-engine.ts`: a run cancelled before the step's start claim is not
      resurrected, and a step result arriving after cancellation wins is dropped.
      Follow the patterns in `workflow-engine.integrity.spec.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass — the baseline is 394
      passing across 51 files, so a drop in count is a regression, not noise.

## Constraints

- Router purity and the termination test are hard gates — see plan §Cross-cutting.
- The step must be reachable but inert by default: a repo with no UI config is the
  common case and must cost nothing.
- Follow the existing step shape in `apps/worker/src/workflow/steps/verify.ts`
  (return `SUCCEEDED` for "the step ran"; pass/fail is state for the router, not
  step failure).
- Any Prisma schema change needs a migration via `pnpm db:migrate <name>`, and the
  repo runs engine-free Prisma (`docs/adr/0001-engine-free-prisma.md`).
- Read `AGENTS.md` before changing anything.

## Out of scope

Playwright · real screenshots · unpinning the mock · any web UI change. Capture is
task 02; this task's step calls `persistUi` with mock output and nothing more.

## Notes

Where UI QA sits in the sequence is a real decision, not a detail: after
`RUN_TESTS` and before `REVIEW` means UI findings reach the code reviewer as
context; after `REVIEW` means a shorter path to `FIX`. State the choice and the
reason in `plan.md` rather than picking silently.
