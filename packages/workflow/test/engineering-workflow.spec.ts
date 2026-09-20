import { describe, expect, it } from 'vitest';
import { PermissionLevel, WorkflowStepKey } from '@engloop/types';
import {
  createInitialWorkflowState,
  decideEngineeringStep,
  ENGINEERING_TASK_STEPS,
  getWorkflowDefinition,
  type WorkflowState,
} from '../src';

const state = (overrides: Partial<WorkflowState> = {}): WorkflowState =>
  createInitialWorkflowState(overrides);

const completeThrough = (...steps: WorkflowStepKey[]): Partial<WorkflowState> => ({
  completedSteps: steps,
});

describe('engineering workflow router', () => {
  it('is a pure function of state', () => {
    const input = state();
    expect(decideEngineeringStep(input)).toEqual(decideEngineeringStep(input));
  });

  it('starts by analysing the repository', () => {
    const decision = decideEngineeringStep(state());
    expect(decision.type).toBe('RUN_STEP');
    if (decision.type === 'RUN_STEP') {
      expect(decision.step.key).toBe(WorkflowStepKey.ANALYZE_REPOSITORY);
    }
  });

  it('plans, then materialises tasks', () => {
    const afterAnalysis = decideEngineeringStep(
      state(completeThrough(WorkflowStepKey.ANALYZE_REPOSITORY)),
    );
    expect(afterAnalysis.type === 'RUN_STEP' && afterAnalysis.step.key).toBe(WorkflowStepKey.PLAN);

    const afterPlan = decideEngineeringStep(
      state(completeThrough(WorkflowStepKey.ANALYZE_REPOSITORY, WorkflowStepKey.PLAN)),
    );
    expect(afterPlan.type === 'RUN_STEP' && afterPlan.step.key).toBe(WorkflowStepKey.CREATE_TASKS);
  });

  it('skips planning when the caller asked to', () => {
    const decision = decideEngineeringStep(
      state({ ...completeThrough(WorkflowStepKey.ANALYZE_REPOSITORY), skipPlanning: true }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.CREATE_WORKTREE);
  });

  it('stops before touching code below LEVEL_2_CODE', () => {
    const decision = decideEngineeringStep(
      state({
        ...completeThrough(
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
        ),
        permissionLevel: PermissionLevel.LEVEL_1_PLAN,
      }),
    );
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
  });

  it('sends failing checks to the fix step', () => {
    const decision = decideEngineeringStep(
      state({
        ...completeThrough(
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
        ),
        testsPassed: false,
      }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.FIX);
  });

  it('reviews once the checks pass', () => {
    const decision = decideEngineeringStep(
      state({
        ...completeThrough(
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
        ),
        testsPassed: true,
      }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.REVIEW);
  });

  it('uses FINAL_REVIEW on the last cycle', () => {
    const decision = decideEngineeringStep(
      state({
        ...completeThrough(
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
        ),
        testsPassed: true,
        reviewCycle: 2,
        maxReviewCycles: 3,
      }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.FINAL_REVIEW);
  });

  it('never loops forever — it escalates once the cycles are spent', () => {
    const decision = decideEngineeringStep(
      state({
        ...completeThrough(
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
        ),
        testsPassed: true,
        reviewApproved: false,
        hasBlockingFindings: true,
        reviewCycle: 3,
        maxReviewCycles: 3,
      }),
    );
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain('3/3');
  });

  it('re-verifies after a fix instead of asking for another unverified fix', () => {
    const afterFix = state({
      ...completeThrough(
        WorkflowStepKey.ANALYZE_REPOSITORY,
        WorkflowStepKey.PLAN,
        WorkflowStepKey.CREATE_TASKS,
        WorkflowStepKey.CREATE_WORKTREE,
        WorkflowStepKey.IMPLEMENT,
        WorkflowStepKey.RUN_TESTS,
        WorkflowStepKey.REVIEW,
        WorkflowStepKey.FIX,
      ),
      // What the FIX step patches: the worktree changed, so the previous
      // verification result no longer describes the code.
      testsPassed: false,
      verificationPending: true,
      hasBlockingFindings: false,
      reviewApproved: false,
      attempt: 1,
      reviewCycle: 1,
    });

    const decision = decideEngineeringStep(afterFix);
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.RETEST);
  });

  it('re-verifies before escalating, even with no attempts left', () => {
    const exhaustedButUnverified = state({
      ...completeThrough(
        WorkflowStepKey.ANALYZE_REPOSITORY,
        WorkflowStepKey.PLAN,
        WorkflowStepKey.CREATE_TASKS,
        WorkflowStepKey.CREATE_WORKTREE,
        WorkflowStepKey.IMPLEMENT,
        WorkflowStepKey.RUN_TESTS,
        WorkflowStepKey.FIX,
      ),
      testsPassed: false,
      verificationPending: true,
      attempt: 3,
      maxAttempts: 3,
    });

    // The last fix still gets checked; escalation happens on the *result*.
    const decision = decideEngineeringStep(exhaustedButUnverified);
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.RETEST);

    expect(
      decideEngineeringStep({ ...exhaustedButUnverified, verificationPending: false }).type,
    ).toBe('WAIT_FOR_HUMAN');
  });

  it('terminates when every fix leaves the checks red', () => {
    // The pessimistic path: implementation and every fix fail verification.
    let current = state({ maxReviewCycles: 3, maxAttempts: 3 });
    const visited: WorkflowStepKey[] = [];
    let guard = 0;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') {
        expect(decision.type).toBe('WAIT_FOR_HUMAN');
        break;
      }
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);

      const key = decision.step.key;
      visited.push(key);
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.IMPLEMENT || key === WorkflowStepKey.FIX
          ? {
              testsPassed: false,
              verificationPending: true,
              hasBlockingFindings: false,
              reviewApproved: false,
              attempt: current.attempt + 1,
            }
          : {}),
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: false, verificationPending: false }
          : {}),
      };
    }

    // Every fix was actually verified rather than stacked on an unchecked one.
    const fixes = visited.filter((key) => key === WorkflowStepKey.FIX).length;
    const retests = visited.filter((key) => key === WorkflowStepKey.RETEST).length;
    expect(fixes).toBeGreaterThan(0);
    expect(retests).toBe(fixes);
  });

  it('terminates: driving the loop always reaches a non-RUN_STEP decision', () => {
    // Simulates the worker: run each step the router asks for, marking it done.
    let current = state({ maxReviewCycles: 3, maxAttempts: 3 });
    let guard = 0;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') {
        expect(['COMPLETE', 'WAIT_FOR_HUMAN', 'FAIL', 'CANCELLED']).toContain(decision.type);
        break;
      }
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);

      const key = decision.step.key;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.IMPLEMENT || key === WorkflowStepKey.FIX
          ? { verificationPending: true }
          : {}),
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? {
              reviewApproved: true,
              hasBlockingFindings: false,
              reviewCycle: current.reviewCycle + 1,
            }
          : {}),
      };
    }
  });

  it('terminates when the reviewer keeps declining without a blocking finding', () => {
    // Checks pass, but the reviewer never approves and never raises a critical or
    // high finding — the case that used to send the same diff back to review forever.
    let current = state({ maxReviewCycles: 3, maxAttempts: 3 });
    let decision = decideEngineeringStep(current);
    let guard = 0;

    while (decision.type === 'RUN_STEP') {
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);
      const key = decision.step.key;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.IMPLEMENT || key === WorkflowStepKey.FIX
          ? { verificationPending: true, attempt: current.attempt + 1 }
          : {}),
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? {
              reviewApproved: false,
              hasBlockingFindings: false,
              reviewCycle: current.reviewCycle + 1,
            }
          : {}),
      };
      decision = decideEngineeringStep(current);
    }

    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain('3/3');
  });

  it('parks the run for a human when the definition of done fails', () => {
    const decision = decideEngineeringStep(
      state({
        completedSteps: [
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
          WorkflowStepKey.REVIEW,
        ],
        failedSteps: [WorkflowStepKey.COMPLETE],
        testsPassed: true,
        reviewApproved: true,
      }),
    );

    // The work exists and the unmet gate is already recorded — a person decides,
    // rather than the run being written off as a hard failure.
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain('Definition of done');
  });

  it('still fails hard when a step other than COMPLETE is exhausted', () => {
    const decision = decideEngineeringStep(
      state({ failedSteps: [WorkflowStepKey.CREATE_WORKTREE] }),
    );
    expect(decision.type).toBe('FAIL');
  });

  it('respects a cancellation signal immediately', () => {
    expect(decideEngineeringStep(state({ cancelled: true })).type).toBe('CANCELLED');
  });

  it('refuses to open a pull request below LEVEL_3_PR', () => {
    const decision = decideEngineeringStep(
      state({
        completedSteps: ENGINEERING_TASK_STEPS.filter(
          (step) =>
            step.key !== WorkflowStepKey.PREPARE_PR && step.key !== WorkflowStepKey.COMPLETE,
        ).map((step) => step.key),
        testsPassed: true,
        reviewApproved: true,
        permissionLevel: PermissionLevel.LEVEL_2_CODE,
      }),
    );
    expect(decision.type).toBe('WAIT_FOR_HUMAN');
    expect(decision.reason).toContain('pull request');
  });

  it('exposes the definition through the registry', () => {
    const definition = getWorkflowDefinition('engineering-task');
    expect(definition.steps).toHaveLength(14);
    expect(() => getWorkflowDefinition('nope')).toThrow();
  });
});

describe('UI QA routing', () => {
  const throughChecks = (overrides: Partial<WorkflowState> = {}) =>
    state({
      completedSteps: [
        WorkflowStepKey.ANALYZE_REPOSITORY,
        WorkflowStepKey.PLAN,
        WorkflowStepKey.CREATE_TASKS,
        WorkflowStepKey.CREATE_WORKTREE,
        WorkflowStepKey.IMPLEMENT,
        WorkflowStepKey.RUN_TESTS,
      ],
      testsPassed: true,
      ...overrides,
    });

  it('is off by default, so a project that never opted in routes straight to review', () => {
    const decision = decideEngineeringStep(throughChecks());
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.REVIEW);
  });

  it('runs UI QA after the checks are green and before code review', () => {
    const decision = decideEngineeringStep(throughChecks({ uiQaEnabled: true }));
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.UI_QA);
  });

  it('never screenshots a red build: failing checks go to FIX, not UI QA', () => {
    const decision = decideEngineeringStep(
      throughChecks({ uiQaEnabled: true, testsPassed: false }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.FIX);
  });

  it('runs at most once per run, so it cannot re-enter on a later review cycle', () => {
    const decision = decideEngineeringStep(
      throughChecks({
        uiQaEnabled: true,
        completedSteps: [
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
          WorkflowStepKey.UI_QA,
        ],
      }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.REVIEW);
  });

  it('sends a blocking UI finding back through the bounded fix loop', () => {
    const decision = decideEngineeringStep(
      throughChecks({
        uiQaEnabled: true,
        completedSteps: [
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
          WorkflowStepKey.UI_QA,
        ],
        hasBlockingFindings: true,
      }),
    );
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.FIX);
  });

  it('degrades rather than failing the task: a failed UI QA is optional', () => {
    // PREPARE_PR is the other optional step; both must be skipped by the
    // failed-step loop so a sound task is not killed by a peripheral failure.
    const decision = decideEngineeringStep(
      throughChecks({
        uiQaEnabled: true,
        failedSteps: [WorkflowStepKey.UI_QA],
        completedSteps: [
          WorkflowStepKey.ANALYZE_REPOSITORY,
          WorkflowStepKey.PLAN,
          WorkflowStepKey.CREATE_TASKS,
          WorkflowStepKey.CREATE_WORKTREE,
          WorkflowStepKey.IMPLEMENT,
          WorkflowStepKey.RUN_TESTS,
        ],
      }),
    );
    expect(decision.type).toBe('RUN_STEP');
    // Not merely "something else now" — a failed optional step must never be
    // asked for again, or the router would spin on it forever.
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.REVIEW);
  });

  it('terminates when UI QA keeps failing', () => {
    // The regression this file's optional-step guard exists for: UI_QA never
    // becomes `done`, so only `failedFinally` stops the router re-requesting it.
    let current = state({ uiQaEnabled: true, failedSteps: [WorkflowStepKey.UI_QA] });
    let guard = 0;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') break;
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);
      expect(decision.step.key, 'a failed optional step was requested again').not.toBe(
        WorkflowStepKey.UI_QA,
      );

      const key = decision.step.key;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? { reviewApproved: true, hasBlockingFindings: false }
          : {}),
      };
    }
  });

  it('terminates: driving the loop with UI QA enabled reaches a non-RUN_STEP decision', () => {
    // The termination proof, re-run with the new branch active. A UI step that
    // could re-enter would spin here rather than fail an assertion elsewhere.
    let current = state({ uiQaEnabled: true, maxReviewCycles: 3, maxAttempts: 3 });
    let guard = 0;
    let sawUiQa = false;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') {
        expect(['COMPLETE', 'WAIT_FOR_HUMAN', 'FAIL', 'CANCELLED']).toContain(decision.type);
        break;
      }
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);

      const key = decision.step.key;
      if (key === WorkflowStepKey.UI_QA) sawUiQa = true;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.IMPLEMENT || key === WorkflowStepKey.FIX
          ? { verificationPending: true }
          : {}),
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? {
              reviewApproved: true,
              hasBlockingFindings: false,
              reviewCycle: current.reviewCycle + 1,
            }
          : {}),
      };
    }

    // Guards against the test passing vacuously because the step never ran.
    expect(sawUiQa, 'UI QA never ran, so this proved nothing').toBe(true);
  });
});

describe('Documentation routing', () => {
  const approved = (overrides: Partial<WorkflowState> = {}) =>
    state({
      completedSteps: [
        WorkflowStepKey.ANALYZE_REPOSITORY,
        WorkflowStepKey.PLAN,
        WorkflowStepKey.CREATE_TASKS,
        WorkflowStepKey.CREATE_WORKTREE,
        WorkflowStepKey.IMPLEMENT,
        WorkflowStepKey.RUN_TESTS,
        WorkflowStepKey.REVIEW,
      ],
      testsPassed: true,
      reviewApproved: true,
      ...overrides,
    });

  it('documents after approval and before the pull request', () => {
    const decision = decideEngineeringStep(approved());
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.DOCUMENT);
  });

  it('is opt-out: disabling it routes straight to the pull request', () => {
    const decision = decideEngineeringStep(approved({ documentationEnabled: false }));
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.PREPARE_PR);
  });

  it('does not document before the reviewer has approved', () => {
    const decision = decideEngineeringStep(approved({ reviewApproved: false }));
    expect(decision.type === 'RUN_STEP' && decision.step.key).not.toBe(WorkflowStepKey.DOCUMENT);
  });

  it('degrades rather than failing the task: a failed DOCUMENT is optional', () => {
    const decision = decideEngineeringStep(
      approved({ failedSteps: [WorkflowStepKey.DOCUMENT] }),
    );
    expect(decision.type).toBe('RUN_STEP');
    // Not merely "something else now" — a failed optional step must never be
    // asked for again, or the router would spin on it forever.
    expect(decision.type === 'RUN_STEP' && decision.step.key).toBe(WorkflowStepKey.PREPARE_PR);
  });

  it('terminates when documentation keeps failing', () => {
    // The same regression the UI QA guard exists for: DOCUMENT never becomes
    // `done`, so only `failedFinally` stops the router re-requesting it.
    let current = state({ failedSteps: [WorkflowStepKey.DOCUMENT] });
    let guard = 0;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') break;
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);
      expect(decision.step.key, 'a failed optional step was requested again').not.toBe(
        WorkflowStepKey.DOCUMENT,
      );

      const key = decision.step.key;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? { reviewApproved: true, hasBlockingFindings: false }
          : {}),
      };
    }
  });

  it('terminates: driving the loop with documentation enabled reaches a non-RUN_STEP decision', () => {
    let current = state({ maxReviewCycles: 3, maxAttempts: 3 });
    let guard = 0;
    let sawDocument = false;

    for (;;) {
      const decision = decideEngineeringStep(current);
      if (decision.type !== 'RUN_STEP') {
        expect(['COMPLETE', 'WAIT_FOR_HUMAN', 'FAIL', 'CANCELLED']).toContain(decision.type);
        break;
      }
      expect(guard++, 'workflow did not terminate').toBeLessThan(50);

      const key = decision.step.key;
      if (key === WorkflowStepKey.DOCUMENT) sawDocument = true;
      current = {
        ...current,
        completedSteps: [...new Set([...current.completedSteps, key])],
        ...(key === WorkflowStepKey.IMPLEMENT || key === WorkflowStepKey.FIX
          ? { verificationPending: true }
          : {}),
        ...(key === WorkflowStepKey.RUN_TESTS || key === WorkflowStepKey.RETEST
          ? { testsPassed: true, verificationPending: false }
          : {}),
        ...(key === WorkflowStepKey.REVIEW || key === WorkflowStepKey.FINAL_REVIEW
          ? { reviewApproved: true, hasBlockingFindings: false }
          : {}),
      };
    }

    // Guards against the test passing vacuously because the step never ran.
    expect(sawDocument, 'documentation never ran, so this proved nothing').toBe(true);
  });
});
