import { AgentRole, AgentRunStatus, RunStatus } from '@engloop/types';
import { implementationOutputSchema, parseSafely } from '@engloop/schemas';
import type { StepHandler } from './types';

/**
 * Builds the implementer's input. On a fix attempt it carries the open review
 * findings and the failing checks, so the agent is told exactly what to repair
 * rather than being asked to re-read the whole task.
 */
const buildImplementationInput = async (
  context: Parameters<StepHandler>[0],
  isFix: boolean,
): Promise<Record<string, unknown>> => {
  const { worker, task, state } = context;

  const fixFindings = isFix
    ? (await worker.reviews.openFindings(task.id)).map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        category: finding.category,
        file: finding.file,
        line: finding.line,
        problem: finding.problem,
        requiredFix: finding.requiredFix,
      }))
    : [];

  const failedChecks =
    isFix && state.lastTestRunId
      ? (
          await worker.prisma.testResult.findMany({
            where: { testRunId: state.lastTestRunId, status: { in: ['FAILED', 'TIMEOUT'] } },
          })
        ).map((result) => ({
          checkType: result.checkType,
          command: result.command,
          exitCode: result.exitCode,
          output: `${result.stdout}\n${result.stderr}`.slice(-8_000),
        }))
      : [];

  return {
    taskId: task.id,
    taskKey: task.key,
    title: task.title,
    objective: task.objective || task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    implementationNotes: task.implementationNotes,
    suggestedFiles: task.suggestedFiles,
    requiredChecks: task.requiredChecks,
    fixFindings,
    failedChecks,
    attempt: task.attemptCount + 1,
  };
};

const runImplementer = async (
  context: Parameters<StepHandler>[0],
  isFix: boolean,
): ReturnType<StepHandler> => {
  const { worker, task, state, traceId, run, step, transitions } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  if (!workspacePath) {
    return { status: RunStatus.FAILED, error: 'No isolated worktree is available' };
  }

  if (isFix) await worker.reviews.markFindingsFixing(task.id);

  await worker.prisma.task.update({
    where: { id: task.id },
    data: { attemptCount: { increment: 1 } },
  });

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.IMPLEMENTER,
    input: await buildImplementationInput(context, isFix),
    workspacePath,
    branchName: state.branchName,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
    attempt: task.attemptCount + 1,
  });

  if (outcome.budgetExceeded) {
    return { status: RunStatus.FAILED, error: 'Cost budget exhausted before implementation' };
  }
  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    return { status: RunStatus.FAILED, error: outcome.error ?? 'Implementation failed' };
  }

  const parsed = parseSafely(implementationOutputSchema, outcome.output, 'implementation output');
  if (!parsed.ok) return { status: RunStatus.FAILED, error: parsed.error.message };

  if (parsed.data.status === 'implementation_blocked') {
    await transitions.to(task.id, 'BLOCKED', {
      reason: parsed.data.blockedReason ?? 'Implementer reported a blocker',
      traceId,
    });
    return {
      status: RunStatus.FAILED,
      error: parsed.data.blockedReason ?? 'Implementer reported a blocker',
    };
  }

  // Commit whatever the agent actually changed. The commit is EngLoop's, not
  // the agent's claim: if the worktree is unchanged, no commit is recorded.
  const commit = await worker.gitManager.commitWork(
    task.id,
    workspacePath,
    `${task.key}: ${isFix ? 'address review findings' : task.title}\n\n${parsed.data.summary}`,
    traceId,
  );

  return {
    status: RunStatus.SUCCEEDED,
    output: { ...parsed.data, commitSha: commit?.sha ?? null },
    patch: {
      lastImplementationSummary: parsed.data.summary,
      // A new implementation invalidates the previous verification result.
      testsPassed: false,
      verificationPending: true,
      reviewApproved: false,
      hasBlockingFindings: false,
      attempt: state.attempt + 1,
    },
  };
};

export const implementStep: StepHandler = (context) => runImplementer(context, false);
export const fixStep: StepHandler = (context) => runImplementer(context, true);

/** CREATE_WORKTREE — idempotent; records the lease provisioned during analysis. */
export const createWorktreeStep: StepHandler = async (context) => {
  const { worker, task, traceId } = context;

  if (!task.repository) {
    return { status: RunStatus.SKIPPED, output: { skipped: 'Task has no repository' } };
  }

  const lease = await worker.gitManager.provisionWorktree({ taskId: task.id, traceId });
  return {
    status: RunStatus.SUCCEEDED,
    output: { path: lease.path, branch: lease.branch, baseRef: lease.baseRef },
    patch: {
      worktreePath: lease.path,
      branchName: lease.branch,
      baseRef: lease.baseRef,
      checkoutPath: lease.checkoutPath,
    },
  };
};
