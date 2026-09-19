import { CheckStatus, type CheckType } from '@engloop/types';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context';

interface RunTestsPayload {
  testRunId: string;
  taskId: string;
  checks: CheckType[];
}

/** Ad-hoc check runs triggered from the UI (POST /tasks/:id/tests). */
export const createTestsProcessor =
  (worker: WorkerContext) =>
  async (job: Job<RunTestsPayload>): Promise<unknown> => {
    const { testRunId, taskId, checks } = job.data;

    const testRun = await worker.prisma.testRun.findUnique({ where: { id: testRunId } });
    if (!testRun) return { skipped: 'test run no longer exists' };

    // Idempotency: a redelivered job must not re-run a completed check set.
    if (testRun.status === CheckStatus.PASSED || testRun.status === CheckStatus.FAILED) {
      return { skipped: 'already completed', status: testRun.status };
    }

    const task = await worker.prisma.task.findUnique({
      where: { id: taskId },
      select: { worktreePath: true },
    });

    return worker.tests.run({
      testRunId,
      taskId,
      checks,
      worktreePath: testRun.worktreePath ?? task?.worktreePath ?? process.cwd(),
      traceId: job.id ?? testRunId,
    });
  };
