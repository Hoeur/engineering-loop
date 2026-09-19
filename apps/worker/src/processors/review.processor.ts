import { AgentRole, AgentRunStatus, RunStatus } from '@engloop/types';
import { parseSafely, reviewOutputSchema } from '@engloop/schemas';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context';

interface RunReviewPayload {
  reviewRunId: string;
  taskId: string;
  kind: string;
}

/** Ad-hoc review runs triggered from the UI (POST /tasks/:id/review). */
export const createReviewProcessor =
  (worker: WorkerContext) =>
  async (job: Job<RunReviewPayload>): Promise<unknown> => {
    const { reviewRunId, taskId } = job.data;

    const reviewRun = await worker.prisma.reviewRun.findUnique({ where: { id: reviewRunId } });
    if (!reviewRun) return { skipped: 'review run no longer exists' };
    if (reviewRun.status === RunStatus.SUCCEEDED) {
      return { skipped: 'already completed' };
    }

    const task = await worker.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { repository: true },
    });
    const workspacePath = task.worktreePath;
    if (!workspacePath) {
      await worker.prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: { status: RunStatus.FAILED, summary: 'No worktree available to review' },
      });
      return { failed: 'no worktree' };
    }

    const diff = await worker.gitManager.captureDiff(
      taskId,
      workspacePath,
      task.repository?.defaultBranch ?? 'main',
    );

    const latestTestRun = await worker.prisma.testRun.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: { results: true },
    });

    const outcome = await worker.agents.execute({
      taskId,
      role: AgentRole.CODE_REVIEWER,
      input: {
        taskId,
        taskKey: task.key,
        title: task.title,
        objective: task.objective || task.title,
        acceptanceCriteria: task.acceptanceCriteria,
        plannerSummary: task.planSummary,
        implementationSummary: null,
        diff: diff.diff,
        diffTruncated: diff.truncated,
        changedFiles: diff.changedFiles,
        testResults: (latestTestRun?.results ?? []).map((result) => ({
          checkType: result.checkType,
          status: result.status,
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: `${result.stdout}\n${result.stderr}`.slice(-4_000),
        })),
        coverage: null,
        cycle: reviewRun.cycle,
        maxCycles: 3,
      },
      workspacePath,
      branchName: task.branchName,
      traceId: job.id ?? reviewRunId,
    });

    if (outcome.status !== AgentRunStatus.SUCCEEDED) {
      await worker.prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: { status: RunStatus.FAILED, summary: outcome.error ?? 'Review failed' },
      });
      return { failed: outcome.error };
    }

    const parsed = parseSafely(reviewOutputSchema, outcome.output, 'review output');
    if (!parsed.ok) {
      await worker.prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: { status: RunStatus.FAILED, summary: parsed.error.message },
      });
      return { failed: parsed.error.message };
    }

    return worker.reviews.persist({
      reviewRunId,
      taskId,
      agentRunId: outcome.agentRunId,
      output: parsed.data,
      cycle: reviewRun.cycle,
    });
  };
