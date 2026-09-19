import { describe, expect, it } from 'vitest';
import { RunStatus, WorkflowStepKey } from '@engloop/types';
import type { WorkflowRun, WorkflowStep } from '@engloop/db';
import {
  defaultPersistedState,
  guardDecision,
  MAX_STEP_EXECUTIONS,
  readState,
} from '../src/workflow/state';
import { STEP_HANDLERS } from '../src/workflow/steps';
import { ENGINEERING_TASK_STEPS, type WorkflowDecision } from '@engloop/workflow';

const step = (overrides: Partial<WorkflowStep>): WorkflowStep =>
  ({
    id: 's1',
    workflowRunId: 'r1',
    stepKey: WorkflowStepKey.IMPLEMENT,
    sequence: 0,
    status: RunStatus.SUCCEEDED,
    attempt: 1,
    maxAttempts: 2,
    input: null,
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as WorkflowStep;

const run = (
  steps: WorkflowStep[],
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun & { steps: WorkflowStep[] } =>
  ({
    id: 'r1',
    definitionId: null,
    definitionKey: 'engineering-task',
    projectId: 'p1',
    taskId: 't1',
    status: RunStatus.RUNNING,
    state: {},
    currentStepKey: null,
    reviewCycle: 0,
    attempt: 0,
    error: null,
    traceId: null,
    idempotencyKey: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    steps,
    ...overrides,
  }) as WorkflowRun & { steps: WorkflowStep[] };

describe('persisted workflow state', () => {
  it('derives completedSteps from the step rows, not the JSON blob', () => {
    const state = readState(
      run(
        [
          step({ stepKey: WorkflowStepKey.PLAN, status: RunStatus.SUCCEEDED }),
          step({ stepKey: WorkflowStepKey.IMPLEMENT, status: RunStatus.RUNNING }),
        ],
        // A crash between "step succeeded" and "state written" leaves a stale blob.
        { state: { completedSteps: [] } as never },
      ),
    );
    expect(state.completedSteps).toContain(WorkflowStepKey.PLAN);
    expect(state.completedSteps).not.toContain(WorkflowStepKey.IMPLEMENT);
  });

  it('only treats a step as finally failed once its attempts are spent', () => {
    const retriable = readState(
      run([step({ status: RunStatus.FAILED, attempt: 1, maxAttempts: 3 })]),
    );
    expect(retriable.failedSteps).toHaveLength(0);

    const exhausted = readState(
      run([step({ status: RunStatus.FAILED, attempt: 3, maxAttempts: 3 })]),
    );
    expect(exhausted.failedSteps).toContain(WorkflowStepKey.IMPLEMENT);
  });

  it('deduplicates repeated cycle steps', () => {
    const state = readState(
      run([
        step({ id: 'a', stepKey: WorkflowStepKey.REVIEW, sequence: 0 }),
        step({ id: 'b', stepKey: WorkflowStepKey.REVIEW, sequence: 1 }),
      ]),
    );
    expect(state.completedSteps.filter((key) => key === WorkflowStepKey.REVIEW)).toHaveLength(1);
  });

  it('counts a skipped step as done so it is not offered again', () => {
    const state = readState(
      run([step({ stepKey: WorkflowStepKey.PREPARE_PR, status: RunStatus.SKIPPED })]),
    );
    expect(state.completedSteps).toContain(WorkflowStepKey.PREPARE_PR);
    expect(state.failedSteps).toHaveLength(0);
  });

  it('carries a cancellation from the run row into state', () => {
    const state = readState(run([], { status: RunStatus.CANCELLED }));
    expect(state.cancelled).toBe(true);
  });

  it('provides safe defaults for a brand-new run', () => {
    const state = defaultPersistedState();
    expect(state.testsPassed).toBe(false);
    expect(state.reviewApproved).toBe(false);
    expect(state.maxReviewCycles).toBe(3);
    expect(state.worktreePath).toBeNull();
  });
});

describe('engine backstop over the router', () => {
  const definitionOf = (key: WorkflowStepKey) => {
    const found = ENGINEERING_TASK_STEPS.find((entry) => entry.key === key);
    if (!found) throw new Error(`no step ${key}`);
    return found;
  };
  const runStep = (key: WorkflowStepKey): WorkflowDecision => ({
    type: 'RUN_STEP',
    step: definitionOf(key),
    reason: 'router',
  });

  it('parks a review the budget no longer covers', () => {
    const decision = guardDecision(
      runStep(WorkflowStepKey.FINAL_REVIEW),
      defaultPersistedState({ reviewCycle: 7, maxReviewCycles: 3 }),
      [step({ attempt: 1 })],
    );
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain('7/3');
  });

  it('parks any run that has used its step budget', () => {
    const decision = guardDecision(runStep(WorkflowStepKey.PREPARE_PR), defaultPersistedState(), [
      step({ attempt: MAX_STEP_EXECUTIONS }),
    ]);
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain(String(MAX_STEP_EXECUTIONS));
  });

  it('passes every other decision through unchanged', () => {
    const review = runStep(WorkflowStepKey.REVIEW);
    expect(guardDecision(review, defaultPersistedState({ reviewCycle: 1 }), [])).toBe(review);

    const done: WorkflowDecision = { type: 'COMPLETE', reason: 'finished' };
    expect(guardDecision(done, defaultPersistedState({ reviewCycle: 9 }), [])).toBe(done);
  });
});

describe('step handler registry', () => {
  it('has a handler for every step the definition declares', () => {
    for (const definition of ENGINEERING_TASK_STEPS) {
      expect(STEP_HANDLERS[definition.key], `missing handler for ${definition.key}`).toBeTypeOf(
        'function',
      );
    }
  });
});
