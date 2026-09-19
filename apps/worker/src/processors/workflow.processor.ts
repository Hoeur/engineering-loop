import { JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import { idempotencyKey } from '@engloop/workflow';
import type { Job } from 'bullmq';
import { type Queue } from 'bullmq';
import type { WorkerContext } from '../context';
import { WorkflowEngine } from '../workflow/workflow-engine';

interface StartPayload {
  workflowRunId: string;
  traceId: string;
  idempotencyKey: string;
}

interface AdvancePayload {
  workflowRunId: string;
  traceId: string;
  idempotencyKey: string;
}

interface SignalPayload {
  workflowRunId: string;
  name: string;
  payload?: { reason?: string };
}

/**
 * Drives the engine one step per job.
 *
 * Re-enqueueing rather than looping in-process keeps each job short, gives every
 * step its own retry/backoff, and lets a restarted worker pick the run back up.
 */
export const createWorkflowProcessor = (worker: WorkerContext, queue: Queue) => {
  const engine = new WorkflowEngine(worker);

  return async (job: Job<StartPayload | AdvancePayload | SignalPayload>): Promise<unknown> => {
    if (job.name === JOB_NAMES.CANCEL_WORKFLOW) {
      const payload = job.data as SignalPayload;
      if (payload.name === 'CANCEL') {
        await engine.cancel(payload.workflowRunId, payload.payload?.reason ?? 'Cancelled');
      }
      return { cancelled: true };
    }

    const payload = job.data as StartPayload | AdvancePayload;
    const result = await engine.advance(payload.workflowRunId, payload.traceId);

    if (result.shouldContinue) {
      await queue.add(
        JOB_NAMES.ADVANCE_WORKFLOW,
        {
          workflowRunId: payload.workflowRunId,
          traceId: payload.traceId,
          idempotencyKey: idempotencyKey('adv', payload.workflowRunId, Date.now()),
        },
        {
          jobId: `advance:${payload.workflowRunId}:${String(Date.now())}`,
          delay: 250,
        },
      );
    }

    return result;
  };
};

export const WORKFLOW_QUEUE = QUEUE_NAMES.WORKFLOW;
