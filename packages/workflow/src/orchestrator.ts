import type { WorkflowStepKey } from '@engloop/types';

/**
 * Orchestration port (spec section 1: "design the workflow service so BullMQ can
 * later be replaced by Temporal").
 *
 * Everything above this line is pure domain logic. The BullMQ adapter lives in
 * `apps/worker`; a Temporal adapter would implement the same three methods and
 * nothing else in the platform would change.
 */
export interface WorkflowStartInput {
  workflowRunId: string;
  definitionKey: string;
  taskId: string;
  projectId: string;
  organizationId: string;
  traceId: string;
  /** Deduplication key — replaying the same start must not fork a second run. */
  idempotencyKey: string;
}

export interface WorkflowAdvanceInput {
  workflowRunId: string;
  traceId: string;
  /** Set when the previous step reported its outcome. */
  completedStep?: WorkflowStepKey;
  idempotencyKey: string;
  delayMs?: number;
}

export interface WorkflowSignal {
  workflowRunId: string;
  name: 'CANCEL' | 'HUMAN_APPROVED' | 'HUMAN_REJECTED' | 'RESUME';
  payload?: Record<string, unknown>;
}

export interface WorkflowOrchestrator {
  readonly name: string;
  start(input: WorkflowStartInput): Promise<void>;
  advance(input: WorkflowAdvanceInput): Promise<void>;
  signal(signal: WorkflowSignal): Promise<void>;
  cancel(workflowRunId: string, reason: string): Promise<void>;
}

/** Used in tests and in the API process, where no queue connection exists. */
export class NoopOrchestrator implements WorkflowOrchestrator {
  readonly name = 'noop';
  readonly started: WorkflowStartInput[] = [];
  readonly advanced: WorkflowAdvanceInput[] = [];
  readonly signals: WorkflowSignal[] = [];

  async start(input: WorkflowStartInput): Promise<void> {
    this.started.push(input);
  }

  async advance(input: WorkflowAdvanceInput): Promise<void> {
    this.advanced.push(input);
  }

  async signal(signal: WorkflowSignal): Promise<void> {
    this.signals.push(signal);
  }

  async cancel(workflowRunId: string, reason: string): Promise<void> {
    this.signals.push({ workflowRunId, name: 'CANCEL', payload: { reason } });
  }
}

/**
 * Deterministic idempotency keys. Queue systems deliver at-least-once, so every
 * job carries one of these and the processor short-circuits on a repeat.
 */
export const idempotencyKey = (...parts: (string | number | undefined)[]): string =>
  parts
    .filter((part) => part !== undefined && part !== '')
    .map(String)
    .join(':');
