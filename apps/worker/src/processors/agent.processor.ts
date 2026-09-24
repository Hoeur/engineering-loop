import { AgentRunStatus } from '@engloop/types';
import { JOB_NAMES } from '@engloop/config';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context';

interface CancelAgentPayload {
  agentRunId: string;
  reason?: string;
}

const CANCEL_AGENT_JOB = `${JOB_NAMES.RUN_AGENT}.cancel`;

const FINISHED_WITHOUT_CANCEL = new Set<AgentRunStatus>([
  AgentRunStatus.SUCCEEDED,
  AgentRunStatus.FAILED,
  AgentRunStatus.TIMED_OUT,
  AgentRunStatus.BUDGET_EXCEEDED,
]);

/**
 * Provider instances keep their active-process handles in memory. Consequently,
 * cancellation reaches a live CLI only when this queue job is consumed by the
 * same worker process that started it. Database cancellation remains global and
 * completion writes are conditional, so another process still cannot resurrect
 * the run or persist post-cancellation output.
 */
export const createAgentProcessor =
  (worker: WorkerContext) =>
  async (job: Job<CancelAgentPayload>): Promise<unknown> => {
    if (job.name !== CANCEL_AGENT_JOB) return { ignored: true };

    const run = await worker.prisma.agentRun.findUnique({
      where: { id: job.data.agentRunId },
      select: { id: true, status: true, providerKey: true },
    });
    if (!run) return { cancelled: false, reason: 'missing' };
    if (FINISHED_WITHOUT_CANCEL.has(run.status)) {
      return { cancelled: false, reason: `already ${run.status}` };
    }
    if (run.status !== AgentRunStatus.CANCELLED) {
      return { cancelled: false, reason: `not cancellation-claimed (${run.status})` };
    }

    const provider = worker.registry.get(run.providerKey);
    await Promise.all([provider.cancelRun(run.id), worker.executionRuntime.cancel(run.id)]);
    return { cancelled: true };
  };
