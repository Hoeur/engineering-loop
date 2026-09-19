import { Inject, Injectable } from '@nestjs/common';
import { JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import type {
  WorkflowAdvanceInput,
  WorkflowOrchestrator,
  WorkflowSignal,
  WorkflowStartInput,
} from '@engloop/workflow';
import type { EngLoopLogger } from '@engloop/logger';
import { LOGGER } from '../logger/logger.tokens';
import { QueueService } from './queue.service';

/**
 * BullMQ implementation of the orchestration port.
 *
 * The rest of the platform depends on `WorkflowOrchestrator`, never on BullMQ,
 * so a Temporal adapter can be dropped in beside this file without touching a
 * single service.
 */
@Injectable()
export class BullMqOrchestrator implements WorkflowOrchestrator {
  readonly name = 'bullmq';

  constructor(
    private readonly queues: QueueService,
    @Inject(LOGGER) private readonly logger: EngLoopLogger,
  ) {}

  async start(input: WorkflowStartInput): Promise<void> {
    await this.queues.enqueue(QUEUE_NAMES.WORKFLOW, JOB_NAMES.START_WORKFLOW, input, {
      jobId: `start:${input.idempotencyKey}`,
    });
    this.logger.info({ workflowRunId: input.workflowRunId }, 'workflow.start.enqueued');
  }

  async advance(input: WorkflowAdvanceInput): Promise<void> {
    await this.queues.enqueue(QUEUE_NAMES.WORKFLOW, JOB_NAMES.ADVANCE_WORKFLOW, input, {
      jobId: `advance:${input.idempotencyKey}`,
      delay: input.delayMs,
    });
  }

  async signal(signal: WorkflowSignal): Promise<void> {
    await this.queues.enqueue(QUEUE_NAMES.WORKFLOW, JOB_NAMES.CANCEL_WORKFLOW, signal, {
      jobId: `signal:${signal.workflowRunId}:${signal.name}:${String(Date.now())}`,
    });
  }

  async cancel(workflowRunId: string, reason: string): Promise<void> {
    await this.signal({ workflowRunId, name: 'CANCEL', payload: { reason } });
  }
}

export const WORKFLOW_ORCHESTRATOR = Symbol('WORKFLOW_ORCHESTRATOR');
