import { AgentRole, PermissionLevel, TaskStatus, WorkflowStepKey } from '@engloop/types';
import {
  createInitialWorkflowState,
  permissionAtLeast,
  type WorkflowDecision,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowStepDefinition,
} from './definition';

const step = (
  definition: Omit<WorkflowStepDefinition, 'optional' | 'maxAttempts'> &
    Partial<Pick<WorkflowStepDefinition, 'optional' | 'maxAttempts'>>,
): WorkflowStepDefinition => ({
  optional: false,
  maxAttempts: 2,
  ...definition,
});

export const ENGINEERING_TASK_STEPS: readonly WorkflowStepDefinition[] = Object.freeze([
  step({
    key: WorkflowStepKey.ANALYZE_REPOSITORY,
    title: 'Repository analysis',
    description: 'Planner inspects the repository, its architecture and its conventions.',
    kind: 'AGENT',
    role: AgentRole.PLANNER,
    entryStatus: TaskStatus.PLANNING,
    requiredPermission: PermissionLevel.LEVEL_0_OBSERVE,
  }),
  step({
    key: WorkflowStepKey.PLAN,
    title: 'Planning',
    description: 'Planner produces an implementation plan and acceptance criteria.',
    kind: 'AGENT',
    role: AgentRole.PLANNER,
    entryStatus: TaskStatus.PLANNING,
    requiredPermission: PermissionLevel.LEVEL_1_PLAN,
  }),
  step({
    key: WorkflowStepKey.CREATE_TASKS,
    title: 'Create tasks',
    description: 'Structured TODOs from the plan are persisted as child tasks.',
    kind: 'SYSTEM',
    role: null,
    entryStatus: TaskStatus.PLAN_READY,
    requiredPermission: PermissionLevel.LEVEL_1_PLAN,
  }),
  step({
    key: WorkflowStepKey.CREATE_WORKTREE,
    title: 'Create worktree',
    description: 'An isolated git worktree and branch are provisioned for the task.',
    kind: 'GIT',
    role: null,
    entryStatus: TaskStatus.QUEUED,
    requiredPermission: PermissionLevel.LEVEL_2_CODE,
    maxAttempts: 3,
  }),
  step({
    key: WorkflowStepKey.IMPLEMENT,
    title: 'Implementation',
    description: 'Implementer writes code and tests inside the isolated worktree.',
    kind: 'AGENT',
    role: AgentRole.IMPLEMENTER,
    entryStatus: TaskStatus.IMPLEMENTING,
    requiredPermission: PermissionLevel.LEVEL_2_CODE,
  }),
  step({
    key: WorkflowStepKey.RUN_TESTS,
    title: 'Deterministic checks',
    description: 'The system independently runs lint, typecheck, tests and build.',
    kind: 'SYSTEM',
    role: null,
    entryStatus: TaskStatus.TESTING,
    requiredPermission: PermissionLevel.LEVEL_2_CODE,
    maxAttempts: 1,
  }),
  step({
    key: WorkflowStepKey.REVIEW,
    title: 'Code review',
    description: 'Reviewer inspects the diff against requirements, security and architecture.',
    kind: 'AGENT',
    role: AgentRole.CODE_REVIEWER,
    entryStatus: TaskStatus.REVIEWING,
    requiredPermission: PermissionLevel.LEVEL_1_PLAN,
  }),
  step({
    key: WorkflowStepKey.FIX,
    title: 'Fix',
    description: 'Implementer resolves review findings and failing checks.',
    kind: 'AGENT',
    role: AgentRole.IMPLEMENTER,
    entryStatus: TaskStatus.FIXING,
    requiredPermission: PermissionLevel.LEVEL_2_CODE,
  }),
  step({
    key: WorkflowStepKey.RETEST,
    title: 'Re-run checks',
    description: 'Deterministic checks are re-run after a fix.',
    kind: 'SYSTEM',
    role: null,
    entryStatus: TaskStatus.TESTING,
    requiredPermission: PermissionLevel.LEVEL_2_CODE,
    maxAttempts: 1,
  }),
  step({
    key: WorkflowStepKey.FINAL_REVIEW,
    title: 'Final review',
    description: 'Last review cycle before approval or human escalation.',
    kind: 'AGENT',
    role: AgentRole.CODE_REVIEWER,
    entryStatus: TaskStatus.REVIEWING,
    requiredPermission: PermissionLevel.LEVEL_1_PLAN,
  }),
  step({
    key: WorkflowStepKey.PREPARE_PR,
    title: 'Prepare pull request',
    description: 'Branch is pushed and a pull request is opened.',
    kind: 'GIT',
    role: null,
    entryStatus: TaskStatus.PR_READY,
    requiredPermission: PermissionLevel.LEVEL_3_PR,
    optional: true,
  }),
  step({
    key: WorkflowStepKey.COMPLETE,
    title: 'Complete',
    description: 'Definition of done verified; the task is closed out.',
    kind: 'SYSTEM',
    role: null,
    // No entry status: the engine applies `entryStatus` *before* running a step,
    // so COMPLETED here would mark the task done before the definition-of-done
    // gates were checked — and COMPLETED is terminal, so the failure path could
    // not move it back. The engine performs the final transition after the
    // workflow wins its terminal status claim and every gate has passed.
    entryStatus: null,
    requiredPermission: PermissionLevel.LEVEL_0_OBSERVE,
    maxAttempts: 1,
  }),
]);

const byKey = new Map(ENGINEERING_TASK_STEPS.map((entry) => [entry.key, entry]));
const getStep = (key: WorkflowStepKey): WorkflowStepDefinition => {
  const found = byKey.get(key);
  if (!found) throw new Error(`Unknown workflow step ${key}`);
  return found;
};

const run = (key: WorkflowStepKey, reason: string): WorkflowDecision => ({
  type: 'RUN_STEP',
  step: getStep(key),
  reason,
});

/**
 * Pure routing function for the engineering loop (spec section 7).
 *
 * No IO, no randomness, no clock — the same state always produces the same
 * decision, which is what makes the loop replayable and unit-testable, and what
 * will let a Temporal workflow drive it unchanged.
 */
export const decideEngineeringStep = (state: WorkflowState): WorkflowDecision => {
  if (state.cancelled) return { type: 'CANCELLED', reason: 'Run was cancelled' };

  const done = (key: WorkflowStepKey) => state.completedSteps.includes(key);
  const failedFinally = (key: WorkflowStepKey) => state.failedSteps.includes(key);

  for (const key of state.failedSteps) {
    const definition = getStep(key);
    if (definition.optional) continue;

    // A failed COMPLETE means the definition-of-done gates were not satisfied:
    // the work exists and the handler has already recorded which gate is unmet.
    // That is a decision for a person, not a dead run.
    if (key === WorkflowStepKey.COMPLETE) {
      return {
        type: 'WAIT_FOR_HUMAN',
        reason: 'Definition of done was not satisfied; the task needs a human decision',
      };
    }

    return { type: 'FAIL', reason: `Step ${definition.title} failed after all attempts` };
  }

  if (!done(WorkflowStepKey.ANALYZE_REPOSITORY)) {
    return run(WorkflowStepKey.ANALYZE_REPOSITORY, 'Repository has not been analysed yet');
  }

  if (!state.skipPlanning) {
    if (!done(WorkflowStepKey.PLAN)) return run(WorkflowStepKey.PLAN, 'No plan produced yet');
    if (!done(WorkflowStepKey.CREATE_TASKS)) {
      return run(WorkflowStepKey.CREATE_TASKS, 'Plan has not been broken into tasks');
    }
  }

  // Governance gate: below LEVEL_2_CODE an agent may plan but never touch code.
  if (!permissionAtLeast(state.permissionLevel, PermissionLevel.LEVEL_2_CODE)) {
    return {
      type: 'WAIT_FOR_HUMAN',
      reason: `Project permission ${state.permissionLevel} allows planning only; a human must promote it to LEVEL_2_CODE to continue.`,
    };
  }

  if (!done(WorkflowStepKey.CREATE_WORKTREE)) {
    return run(WorkflowStepKey.CREATE_WORKTREE, 'No isolated worktree provisioned');
  }

  if (!done(WorkflowStepKey.IMPLEMENT)) {
    return run(WorkflowStepKey.IMPLEMENT, 'Implementation has not run');
  }

  if (!done(WorkflowStepKey.RUN_TESTS)) {
    return run(WorkflowStepKey.RUN_TESTS, 'Deterministic checks have not run');
  }

  // Bounded fix loop — never infinite (spec section 7).
  if (!state.testsPassed || (!state.reviewApproved && state.hasBlockingFindings)) {
    // A fix rewrote the worktree, so `testsPassed` describes the *previous*
    // revision. Re-verify before asking for another fix — otherwise the loop
    // would burn every attempt on fixes it never checked, and a fix that
    // actually worked would never be noticed.
    if (state.verificationPending) {
      return run(WorkflowStepKey.RETEST, 'Code changed; re-running deterministic checks');
    }

    if (state.reviewCycle >= state.maxReviewCycles || state.attempt >= state.maxAttempts) {
      return {
        type: 'WAIT_FOR_HUMAN',
        reason: `Exhausted ${String(state.reviewCycle)}/${String(state.maxReviewCycles)} review cycles and ${String(state.attempt)}/${String(state.maxAttempts)} attempts`,
      };
    }
    if (!state.testsPassed) {
      return run(WorkflowStepKey.FIX, 'Deterministic checks are failing');
    }
    return run(WorkflowStepKey.FIX, 'Reviewer requested changes');
  }

  if (!state.reviewApproved) {
    // The review budget bounds this branch too: a reviewer that keeps declining
    // without a blocking finding must not get the same diff back forever.
    if (state.reviewCycle >= state.maxReviewCycles) {
      return {
        type: 'WAIT_FOR_HUMAN',
        reason: `Reviewer did not approve after ${String(state.reviewCycle)}/${String(state.maxReviewCycles)} review cycles`,
      };
    }
    const isFinalCycle = state.reviewCycle >= state.maxReviewCycles - 1;
    return run(
      isFinalCycle ? WorkflowStepKey.FINAL_REVIEW : WorkflowStepKey.REVIEW,
      `Review cycle ${String(state.reviewCycle + 1)} of ${String(state.maxReviewCycles)}`,
    );
  }

  if (state.createPullRequest && !done(WorkflowStepKey.PREPARE_PR)) {
    if (!permissionAtLeast(state.permissionLevel, PermissionLevel.LEVEL_3_PR)) {
      return {
        type: 'WAIT_FOR_HUMAN',
        reason: `Approved, but permission ${state.permissionLevel} does not allow opening a pull request.`,
      };
    }
    if (!failedFinally(WorkflowStepKey.PREPARE_PR)) {
      return run(WorkflowStepKey.PREPARE_PR, 'Task approved; opening pull request');
    }
  }

  if (!done(WorkflowStepKey.COMPLETE)) {
    return run(WorkflowStepKey.COMPLETE, 'All gates satisfied');
  }

  return { type: 'COMPLETE', reason: 'Workflow finished' };
};

export const ENGINEERING_TASK_WORKFLOW: WorkflowDefinition = Object.freeze({
  key: 'engineering-task',
  version: 1,
  name: 'EngineeringTaskWorkflow',
  description:
    'Plan → implement → verify → review → fix → approve → pull request, with a bounded review loop.',
  steps: ENGINEERING_TASK_STEPS,
  decide: decideEngineeringStep,
});

export const WORKFLOW_REGISTRY: Readonly<Record<string, WorkflowDefinition>> = Object.freeze({
  [ENGINEERING_TASK_WORKFLOW.key]: ENGINEERING_TASK_WORKFLOW,
});

export const getWorkflowDefinition = (key: string): WorkflowDefinition => {
  const definition = WORKFLOW_REGISTRY[key];
  if (!definition) throw new Error(`Unknown workflow definition "${key}"`);
  return definition;
};

export { createInitialWorkflowState };
