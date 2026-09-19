# 01 — UI_QA step · plan

**Spec:** `./spec.md` · **Baseline:** commit `9d58bc4` (lint/typecheck clean, 394 tests passing)

## Approach

Add `UI_QA` as a twelfth-and-a-half step: a real `WorkflowStepDefinition`, a real
`STEP_HANDLERS` entry, and one new router branch. The step calls the existing,
currently-unreachable `ReviewEngine.persistUi()` with mock provider output. No
Playwright, no screenshots — task 02 replaces the capture source behind the same
seam.

### Decision 1 — placement: after RUN_TESTS, before REVIEW

The spec flags this as a real decision. Choosing **after the checks pass, before
code review**, because:

- UI findings become *context* for the code reviewer rather than a second,
  independent verdict arriving afterwards.
- It reuses the existing bounded fix loop untouched: `hasBlockingFindings` is
  already the router's gate, and `persistUi` already computes blocking counts the
  same way `persist` does. A blocking UI finding therefore routes to `FIX` through
  the path that already exists and is already termination-tested.
- Running it *before* checks pass would screenshot a build that may not compile.

### Decision 2 — enablement: `Project.settings.uiQa`

`Project.settings` is already `Json @default("{}")` (`schema.prisma:486`), so
enablement needs **no migration**. Shape:

```jsonc
{ "uiQa": { "enabled": true, "pages": ["/"] } }
```

Absent or `enabled: false` → the step never runs. This satisfies "optional by
default" without a schema change, and task 02 extends the same object with the
base URL once Q2 is answered.

### Decision 3 — router state: one new flag pair

`WorkflowState` gains `uiQaEnabled: boolean` (default **false**) and
`uiQaDone` is expressed via the existing `completedSteps`, so no extra bookkeeping.
Default-false is what makes every existing test keep passing unchanged: a state
built by `createInitialWorkflowState()` routes exactly as it does today.

The new branch sits between the RUN_TESTS check and the fix loop:

```ts
if (state.uiQaEnabled && !done(WorkflowStepKey.UI_QA) && state.testsPassed) {
  return run(WorkflowStepKey.UI_QA, 'Checks pass; capturing UI review');
}
```

Guarding on `state.testsPassed` keeps it off a red build, and `done()` makes it
run once per run rather than once per review cycle — which is what keeps the
termination proof intact.

## Files to touch

| File | Change |
| --- | --- |
| `packages/types/src/enums.ts:144` | add `UI_QA` to `WorkflowStepKey` |
| `packages/workflow/src/definition.ts:37` | add `uiQaEnabled` to `WorkflowState` + `createInitialWorkflowState` (default `false`) |
| `packages/workflow/src/engineering-workflow.ts` | add the `UI_QA` step definition + the router branch |
| `packages/workflow/test/engineering-workflow.spec.ts` | new termination test with `uiQaEnabled: true`; assert default-off is unchanged |
| `apps/worker/src/workflow/steps/ui-qa.ts` | **new** — the step handler |
| `apps/worker/src/workflow/steps/index.ts` | register the handler |
| `apps/worker/src/workflow/steps/ui-qa.spec.ts` | **new** — skip path, persist path, cancellation race |
| `apps/worker/src/workflow/workflow-engine.ts` | populate `uiQaEnabled` from `project.settings` when building state |

## Step definition

```ts
step({
  key: WorkflowStepKey.UI_QA,
  title: 'UI review',
  description: 'Screenshots are captured and reviewed for layout, responsive and accessibility defects.',
  kind: 'AGENT',
  role: AgentRole.UI_REVIEWER,
  entryStatus: TaskStatus.REVIEWING,
  requiredPermission: PermissionLevel.LEVEL_1_PLAN,
  optional: true,   // a UI QA failure must not kill a task whose code is sound
  maxAttempts: 1,
})
```

`optional: true` is deliberate and load-bearing: the router's `failedSteps` loop
(`engineering-workflow.ts:~160`) `continue`s past optional steps, so a UI QA
failure degrades instead of failing the task — matching `PREPARE_PR`'s treatment
and the spec's "SKIP cleanly, never fail" requirement.

## Risks

1. **Termination proof.** The new branch must not add a cycle. Mitigated by
   gating on `done(UI_QA)`, so it fires at most once; the new termination test
   with `uiQaEnabled: true` is the real check.
2. **Router purity.** Reading `Project.settings` happens in the *engine* when
   state is built, never inside `decideEngineeringStep` — the router only sees a
   boolean. This is the rule the plan's cross-cutting §4 protects.
3. **Existing tests.** `uiQaEnabled` defaults to false, so all 30 workflow tests
   and the 394-test suite should be unaffected. A drop is a regression.
4. **Cancellation.** The handler must observe the semantics added in
   `workflow-engine.integrity.spec.ts` — no `ReviewRun`/finding rows written when
   cancellation wins.
5. **Ownership.** Any `ReviewRun` the step creates carries its `taskId`, or
   `ownedScreenshotWhere`/`ownedFindingWhere` make its children invisible to
   every tenant (plan cross-cutting §7).

## Could not determine from the code

- Whether `UI_REVIEWER` should be gated at `LEVEL_1_PLAN` (review-like, chosen
  here) or `LEVEL_2_CODE` (it will eventually drive a browser). Chosen the former
  to match `REVIEW`; flagging because task 02 changes the risk profile.
- The `pages` default. Using `["/"]` as the single sensible default; the real
  answer depends on Q2.
