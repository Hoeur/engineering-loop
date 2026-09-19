import {
  AgentRole,
  AgentRunStatus,
  CheckStatus,
  DEFAULT_REQUIRED_CHECKS_FALLBACK,
  RunStatus,
  type CheckType,
} from './check-defaults';
import { reviewOutputSchema, parseSafely } from '@engloop/schemas';
import type { StepHandler } from './types';

/**
 * RUN_TESTS / RETEST — the system's own verification pass.
 *
 * Deliberately independent of anything the implementer reported: EngLoop runs
 * the commands, reads the exit codes and decides (spec sections 13 and 43).
 */
const runChecks: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  const checks: CheckType[] =
    task.requiredChecks.length > 0
      ? task.requiredChecks
      : (DEFAULT_REQUIRED_CHECKS_FALLBACK as CheckType[]);

  const testRun = await worker.prisma.testRun.create({
    data: {
      taskId: task.id,
      workflowRunId: run.id,
      workflowStepId: step.id,
      status: CheckStatus.QUEUED,
      totalChecks: checks.length,
      worktreePath: workspacePath,
      attempt: state.attempt + 1,
    },
  });

  const outcome = await worker.tests.run({
    testRunId: testRun.id,
    taskId: task.id,
    checks,
    worktreePath: workspacePath ?? process.cwd(),
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  return {
    // The step itself succeeded — it ran the checks. Whether the checks passed
    // is state, not step failure; the router decides what happens next.
    status: RunStatus.SUCCEEDED,
    output: {
      testRunId: outcome.testRunId,
      passed: outcome.passed,
      totals: outcome.totals,
      failedChecks: outcome.failedChecks.map((check) => ({
        checkType: check.checkType,
        command: check.command,
        exitCode: check.exitCode,
      })),
    },
    patch: {
      testsPassed: outcome.passed,
      // The current revision has now been verified for real, by exit code.
      verificationPending: false,
      lastTestRunId: outcome.testRunId,
      failedCheckSummary: outcome.failedChecks.map(
        (check) => `${check.checkType}: exit ${String(check.exitCode)}`,
      ),
    },
  };
};

export const runTestsStep: StepHandler = runChecks;
export const retestStep: StepHandler = runChecks;

/** REVIEW / FINAL_REVIEW — reviewer sees the diff, the checks and the criteria. */
const runReview: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  if (!workspacePath) {
    return { status: RunStatus.FAILED, error: 'No worktree to review' };
  }

  const diff = await worker.gitManager.captureDiff(
    task.id,
    workspacePath,
    state.baseRef ?? task.repository?.defaultBranch ?? 'main',
  );

  const testResults = state.lastTestRunId
    ? await worker.prisma.testResult.findMany({ where: { testRunId: state.lastTestRunId } })
    : [];

  const reviewRun = await worker.prisma.reviewRun.create({
    data: {
      taskId: task.id,
      workflowRunId: run.id,
      workflowStepId: step.id,
      kind: 'CODE',
      status: RunStatus.RUNNING,
      cycle: state.reviewCycle + 1,
      startedAt: new Date(),
      diffSha: diff.artifactId,
    },
  });

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.CODE_REVIEWER,
    input: {
      taskId: task.id,
      taskKey: task.key,
      title: task.title,
      objective: task.objective || task.title,
      acceptanceCriteria: task.acceptanceCriteria,
      plannerSummary: state.plannerSummary,
      implementationSummary: state.lastImplementationSummary,
      diff: diff.diff,
      diffTruncated: diff.truncated,
      changedFiles: diff.changedFiles,
      testResults: testResults.map((result) => ({
        checkType: result.checkType,
        status: result.status,
        command: result.command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: `${result.stdout}\n${result.stderr}`.slice(-4_000),
      })),
      coverage: null,
      cycle: state.reviewCycle + 1,
      maxCycles: state.maxReviewCycles,
    },
    workspacePath,
    branchName: state.branchName,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    await worker.prisma.reviewRun.update({
      where: { id: reviewRun.id },
      data: { status: RunStatus.FAILED, completedAt: new Date() },
    });
    return { status: RunStatus.FAILED, error: outcome.error ?? 'Review failed' };
  }

  const parsed = parseSafely(reviewOutputSchema, outcome.output, 'review output');
  if (!parsed.ok) {
    await worker.prisma.reviewRun.update({
      where: { id: reviewRun.id },
      data: { status: RunStatus.FAILED, completedAt: new Date() },
    });
    return { status: RunStatus.FAILED, error: parsed.error.message };
  }

  const persisted = await worker.reviews.persist({
    reviewRunId: reviewRun.id,
    taskId: task.id,
    agentRunId: outcome.agentRunId,
    output: parsed.data,
    cycle: state.reviewCycle + 1,
  });

  if (persisted.approved) {
    await worker.reviews.resolveFindings(task.id);
  }

  await worker.prisma.task.update({
    where: { id: task.id },
    data: { reviewCycle: state.reviewCycle + 1 },
  });

  return {
    status: RunStatus.SUCCEEDED,
    output: {
      reviewRunId: reviewRun.id,
      decision: persisted.decision,
      findings: persisted.findingCount,
      blocking: persisted.blockingCount,
      score: parsed.data.score,
    },
    patch: {
      reviewApproved: persisted.approved,
      // Any review that does not approve sends the work back through FIX, which the
      // router bounds by maxReviewCycles and maxAttempts. Reviewing the same unchanged
      // diff again would only repeat the verdict — that was an endless loop whenever
      // the reviewer declined without a critical/high finding.
      hasBlockingFindings: persisted.blockingCount > 0 || !persisted.approved,
      lastReviewRunId: reviewRun.id,
      reviewCycle: state.reviewCycle + 1,
    },
  };
};

export const reviewStep: StepHandler = runReview;
export const finalReviewStep: StepHandler = runReview;
