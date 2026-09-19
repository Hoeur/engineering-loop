import { RunStatus, WorkflowStepKey } from '@engloop/types';
import {
  createInitialWorkflowState,
  type WorkflowDecision,
  type WorkflowState,
} from '@engloop/workflow';
import type { WorkflowRun, WorkflowStep } from '@engloop/db';

/**
 * Persisted workflow state = the pure `WorkflowState` the router consumes, plus
 * the execution details the step handlers need. Kept in one JSON column so a
 * run can be replayed from the database alone.
 */
export interface PersistedWorkflowState extends WorkflowState {
  planOnly: boolean;
  requirement: string;
  constraints: string[];
  targetPaths: string[];
  worktreePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  checkoutPath: string | null;
  lastTestRunId: string | null;
  lastReviewRunId: string | null;
  lastImplementationSummary: string | null;
  plannerSummary: string | null;
  failedCheckSummary: string[];
  createdChildTaskIds: string[];
}

export const defaultPersistedState = (
  overrides: Partial<PersistedWorkflowState> = {},
): PersistedWorkflowState => ({
  ...createInitialWorkflowState(),
  planOnly: false,
  requirement: '',
  constraints: [],
  targetPaths: [],
  worktreePath: null,
  branchName: null,
  baseRef: null,
  checkoutPath: null,
  lastTestRunId: null,
  lastReviewRunId: null,
  lastImplementationSummary: null,
  plannerSummary: null,
  failedCheckSummary: [],
  createdChildTaskIds: [],
  ...overrides,
});

/**
 * Rebuilds state from the persisted JSON *and* the step rows.
 *
 * Deriving completedSteps from rows rather than trusting the JSON blob makes the
 * engine tolerant of a crash between "step succeeded" and "state written".
 */
export const readState = (run: WorkflowRun & { steps: WorkflowStep[] }): PersistedWorkflowState => {
  const stored = defaultPersistedState((run.state ?? {}) as Partial<PersistedWorkflowState>);

  // SKIPPED is done as well: a step that had nothing to do (no repository, no branch
  // to open a pull request from) would otherwise be offered again on every advance.
  const completedSteps = run.steps
    .filter((step) => step.status === RunStatus.SUCCEEDED || step.status === RunStatus.SKIPPED)
    .map((step) => step.stepKey as WorkflowStepKey);

  const failedSteps = run.steps
    .filter((step) => step.status === RunStatus.FAILED && step.attempt >= step.maxAttempts)
    .map((step) => step.stepKey as WorkflowStepKey);

  return {
    ...stored,
    completedSteps: [...new Set(completedSteps)],
    failedSteps: [...new Set(failedSteps)],
    cancelled: run.status === RunStatus.CANCELLED || stored.cancelled,
  };
};

/**
 * A repeated FIX/RETEST/REVIEW cycle must not be blocked by the "already
 * completed" check, so those keys are cleared when a new cycle begins.
 */
export const CYCLE_STEPS: WorkflowStepKey[] = [
  WorkflowStepKey.FIX,
  WorkflowStepKey.RETEST,
  WorkflowStepKey.RUN_TESTS,
  WorkflowStepKey.REVIEW,
  WorkflowStepKey.FINAL_REVIEW,
];

/**
 * Step executions (attempts included) one run may use. A full run with three review
 * cycles and a retry or two needs about 25, so this only trips when the router is
 * not converging — and every agent step it stops is real spend.
 */
export const MAX_STEP_EXECUTIONS = 60;

/**
 * Engine-side backstop over the router's decision: whatever the routing bug, a run
 * ends up with a person instead of looping (and spending) forever.
 */
export const guardDecision = (
  decision: WorkflowDecision,
  state: PersistedWorkflowState,
  steps: readonly Pick<WorkflowStep, 'attempt'>[],
): WorkflowDecision => {
  if (decision.type !== 'RUN_STEP') return decision;

  const executions = steps.reduce((total, step) => total + step.attempt, 0);
  if (executions >= MAX_STEP_EXECUTIONS) {
    return {
      type: 'WAIT_FOR_HUMAN',
      reason: `Stopped after ${String(executions)} step executions; the run is not converging`,
    };
  }

  const review =
    decision.step.key === WorkflowStepKey.REVIEW ||
    decision.step.key === WorkflowStepKey.FINAL_REVIEW;
  if (review && state.reviewCycle >= state.maxReviewCycles) {
    return {
      type: 'WAIT_FOR_HUMAN',
      reason: `Reviewer did not approve after ${String(state.reviewCycle)}/${String(state.maxReviewCycles)} review cycles`,
    };
  }

  return decision;
};
