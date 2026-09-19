# real-ui-qa

Phase: task 01 complete | Iteration: 1 of 3
Plan index: `.loop/plan-real-ui-qa.md`

## Done

- Intake · scope survey · plan + 4 specs · re-survey after the tenant-isolation
  change.
- **Git baseline** — commit `9d58bc4`, 443 source files, no secrets or scratch.
  B1 resolved.
- **Task 01 — UI_QA workflow step** — commit `94a1b76`. Passed on iteration 1:
  no blockers, all gates green.

## Verified at `94a1b76` — ran, not reported

- `pnpm lint` → clean (`--max-warnings=0`)
- `pnpm typecheck` → clean, 11 packages + 3 apps
- `pnpm test` → **409 passing / 0 failing** (baseline was 394; +15 new)
- `prisma migrate diff` snapshot vs schema → "empty migration" (no drift)

## Two defects the loop caught

1. **Infinite loop in the router.** `UI_QA` is `optional`, so the failed-step
   loop skips past it; gating only on `done()` meant a failed UI QA was never
   done and was re-requested forever. Caught by the optional-step test, fixed
   with a `failedFinally` guard, and locked in by a dedicated termination test.
2. **Stale migration snapshot.** `prisma/migrations/applied-datamodel.prisma`
   is the baseline `create-migration.mjs` diffs against. A hand-written
   migration left it stale, so the *next* generated migration would have
   re-emitted the `UI_QA` change. Found during diff review, not by a test.

## Open blockers

- B2: **Q1** execution model (in-process / subprocess / deferred) — blocks 02.
- B3: **Q2** who starts the app under test — blocks 02.
- B4: **Q3** screenshot storage (base64 vs object storage) — blocks 02.

Resolved this round: B1 (git baseline).

## Next

Task 02 is the only unblocked-by-dependency task, but it is **blocked on Q1–Q3**
and those are user decisions, not implementer guesses. Nothing else in the plan
can start: 03 and 04 both depend on 02.
