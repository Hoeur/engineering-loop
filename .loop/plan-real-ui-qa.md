# Plan — Real UI QA (roadmap #4)

**Status:** planned, not started
**Created:** 2026-09-19 · **Re-surveyed:** 2026-09-19 after the tenant-isolation change
**Source:** `docs/roadmap.md` item 4 — "Drive Playwright against the running app,
capture the three viewport screenshots, collect console and network errors, feed
the `UI_REVIEWER` role — the only role still pinned to the mock."

## Re-survey — what changed since the first draft

A multi-tenant isolation pass landed across nine API/worker source files. It does
not touch the UI QA gap, but it changes two tasks in this plan and adds a
constraint that every task now inherits.

Verified green at re-survey: `pnpm lint` clean, `pnpm typecheck` clean across 11
packages + 3 apps, `pnpm test` **394 passing / 51 files / 0 failing**.

What landed:

- `apps/api/src/common/tenant-ownership.ts` (313 lines, new) — fail-closed
  `owned*Where` builders. A row needs at least one owner and **every populated
  owner must be in the same tenant**; `ownedFindingSql` is the raw-SQL variant.
- Every read path in `tasks`, `reviews`, `workflows`, `agent-runs` and
  `task-transition` services now takes `organizationId` and scopes through
  `project: { organizationId }`.
- `apps/api/src/modules/tenant-integrity.services.spec.ts` (918 lines) and
  `tenant-isolation.services.spec.ts` (410 lines), new.
- Worker: cancellation/start race handling in `workflow-engine.ts` and
  `agent-executor.ts` — a run cancelled before its start claim is no longer
  resurrected, and a step result is dropped when cancellation wins mid-handler.
  Covered by `workflow-engine.integrity.spec.ts` (389 lines, new).

**Impact on this plan:**

- **`ownedScreenshotWhere` already exists** (`tenant-ownership.ts:170`) and is
  already called by `reviews.service.ts:86`. Task 04 no longer needs to design
  screenshot authorization — it consumes this. Note its shape: a screenshot needs
  a `taskId` or a `reviewRunId`, and a populated `reviewRun` must itself be owned.
- **A UI QA page already exists** — `apps/web/app/quality/ui-qa/page.tsx` renders
  `VIEWPORT_PRESETS`, a `FindingsScreen` over `['UI', 'ACCESSIBILITY']`, and a
  paragraph stating capture is mocked. Task 04 is now *extend and correct*, not
  *build*. That paragraph becomes false the moment task 02 ships and must change
  in the same task.
- **New cross-cutting constraint:** any new read path is tenant-scoped and
  fail-closed from its first commit (see §Cross-cutting rule 7). Retrofitting
  scoping is exactly what the 1,328 lines of new spec exist to prevent.

**Unchanged by the update** — re-verified directly, not assumed:
`persistUi` still has zero callers · no `UI_QA` in `WorkflowStepKey` or
`STEP_HANDLERS` · Playwright still absent from `apps/worker/package.json` · repo
still not under git.

---

## What the survey actually found

The roadmap line understates the work. The pipeline is **modelled but not
wired** — this is not "swap the mock for Playwright", it is building the step
that would call it.

What exists today:

| Piece | State | Location |
| --- | --- | --- |
| `Screenshot` model (page, viewport, w/h, storagePath, dataUri, consoleErrors, failedRequests) | exists, unused | `packages/db/prisma/schema.prisma:1235` |
| `Viewport` enum + `VIEWPORT_PRESETS` (1440×900 / 768×1024 / 375×812) | exists | `packages/types/src/enums.ts:244` |
| `uiReviewInputSchema` / `uiReviewOutputSchema` | exists | `packages/schemas/src/agent-contracts.ts:323` |
| `ROLE_OUTPUT_SCHEMAS.UI_REVIEWER` | exists | `packages/schemas/src/agent-contracts.ts:431` |
| `ReviewEngine.persistUi()` | exists, **zero callers** | `apps/worker/src/services/review-engine.ts:93` |
| Mock `reviewUi()` | exists | `packages/agent-sdk/src/providers/mock.ts:139` |
| `WorkflowStepKey.UI_QA` | **does not exist** | `packages/types/src/enums.ts:144` — 12 keys, no UI step |
| Screenshot capture service | **does not exist** | — |
| Playwright in the worker | **not a dependency** | only `apps/web` has `@playwright/test@1.55.1` |

So the honest framing: **`persistUi` is dead code today.** Nothing in
`STEP_HANDLERS` (`apps/worker/src/workflow/steps/index.ts`) can reach it, because
there is no UI step to reach it from.

---

## Ordering rationale

Four tasks, each shippable and reviewable alone. The order is forced by the
dependency chain — capture has nothing to store into until the step exists, and
the reviewer has nothing to look at until capture works.

The riskiest task is **02 (capture)**, not the wiring. Running a browser inside
the worker collides with the security model: the command runner refuses
executables outside its allowlist (`packages/git/src/command-runner.ts:87`), and
roadmap #1 flags agent sandboxing as the largest open risk. Decide the execution
model in 02 before writing capture code, not after.

| # | Task | Depends on | Ships |
| --- | --- | --- | --- |
| 01 | `UI_QA` workflow step + router placement | — | A step that runs, marks itself SKIPPED when UI QA is off, and reaches `persistUi` with mock output |
| 02 | Playwright screenshot capture service | 01 | Real screenshots at 3 viewports, persisted as `Screenshot` rows with console/network errors |
| 03 | Feed `UI_REVIEWER` with real capture output | 01, 02 | Mock unpinned; a real provider receives `uiReviewInput` built from real rows |
| 04 | Surface UI findings + screenshots in the web UI | 03 | Findings and images visible on task detail |

---

## Cross-cutting constraints

Every task inherits these. They are not negotiable per-task.

1. **A claim is not evidence** (README's governing rule). Screenshot capture must
   be verified by the worker reading files/exit codes, never by an agent
   reporting success.
2. **Vendor names stay in `packages/agent-sdk/src/providers/`.** Nothing outside
   that directory may name a provider.
3. **The API may not spawn processes or touch a working copy.** Capture belongs
   in the worker, full stop (`README.md` — Architecture).
4. **`decideEngineeringStep` is a pure function** — no IO, clock or randomness,
   and it has a termination test. Any router change must keep both properties.
5. **Zero-warning lint, `tsc --noEmit` clean, Vitest green** — `pnpm lint`,
   `pnpm typecheck`, `pnpm test`.
6. **UI QA must be optional.** Most repositories have no UI. A missing or
   disabled UI QA config must SKIP cleanly, never fail the task.
7. **Tenant-scoped and fail-closed from the first commit.** Any new read path
   goes through the `owned*Where` builders in
   `apps/api/src/common/tenant-ownership.ts`; a row needs at least one owner and
   every populated owner must be in the same tenant. Screenshots already have
   `ownedScreenshotWhere` — use it rather than writing a new filter.

---

## Open questions for the user — answer before task 02

These change the design, so they are not for an implementer to guess:

- **Q1 — Execution model.** Does Playwright run (a) in-process in the worker via
  the Node API, (b) as an allowlisted `npx playwright` subprocess, or (c) deferred
  until the sandboxing work in roadmap #1 lands? Option (a) is simplest but puts
  a browser in the worker's own process; (b) fits the existing runner but needs
  an allowlist entry; (c) blocks this plan.
- **Q2 — Who starts the app under test?** Capture needs a running app at a URL.
  Does EngLoop boot the target repo's dev server itself (new capability, new
  risk), or does a project configure a reachable preview URL?
- **Q3 — Screenshot storage.** `Screenshot.dataUri` is documented as the MVP path
  ("so screenshots render without object storage"). Stay with base64 in Postgres,
  or introduce object storage now? Three viewports per page per run grows fast.

---

## Not in this plan

Sandboxed execution (roadmap #1) · object storage · visual regression diffing
against a baseline · accessibility auditing beyond what `UiFindingCategory`
already models · auto-fixing UI findings.

---

## Progress

- [x] 01-ui-qa-step — commit `94a1b76`, 409 tests passing
- [ ] 02-screenshot-capture — **blocked on Q1–Q3**
- [ ] 03-ui-reviewer-wiring
- [ ] 04-web-surfacing

**Carry-forward notes:** _(each task appends what changed a later task's
assumptions — interfaces that ended up different, files that moved, decisions the
plan did not anticipate)_

### From 01 → 02

- **The seam to fill.** `apps/worker/src/workflow/steps/ui-qa.ts` reads
  `prisma.screenshot.findMany({ where: { taskId } })` and returns `SKIPPED` when
  it finds nothing. Task 02 makes that query non-empty; it should not need to
  change the step's shape.
- **Enablement shape is decided:** `Project.settings.uiQa.enabled === true`, read
  by `isUiQaEnabled()` in `workflow-engine.ts`. No migration was needed. Task 02
  extends the same object with the base URL once Q2 is answered — anything not
  explicitly `true` means off.
- **Placement is decided:** after `RUN_TESTS`, before `REVIEW`, gated on
  `testsPassed`. Capture therefore never runs against a build that failed its
  checks.
- **The step is `optional: true`**, which required a second router guard
  (`failedFinally`) that the plan did not anticipate. Any future optional step
  needs both guards or the router spins. A test covers it.
- **A migration was needed after all** — `WorkflowStepKey` is a Prisma enum too.
  `20260919120000_workflow_step_ui_qa` adds `UI_QA BEFORE 'REVIEW'`. Note for any
  future schema work: hand-written migrations must **also** be applied to
  `prisma/migrations/applied-datamodel.prisma`, the snapshot
  `create-migration.mjs` diffs against, or the next generated migration re-emits
  the change. Verified with `prisma migrate diff` → "empty migration".
- **Untrusted-id handling already exists.** The step nulls any `screenshotId` a
  reviewer returns that does not belong to the task. Task 03's equivalent
  acceptance criterion is therefore already satisfied at this seam — verify
  rather than rebuild.
- **Unresolved, deliberately:** `UI_REVIEWER` is gated at `LEVEL_1_PLAN` to match
  `REVIEW`. Task 02 puts a browser behind this role, which changes the risk
  profile — revisit whether it should be `LEVEL_2_CODE`.
