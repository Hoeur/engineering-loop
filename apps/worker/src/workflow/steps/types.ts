import type { RunStatus, WorkflowStepKey } from '@engloop/types';
import type { WorkflowStepDefinition } from '@engloop/workflow';
import type { EngLoopLogger } from '@engloop/logger';
import type { Repository, Task, WorkflowRun, WorkflowStep } from '@engloop/db';
import type { WorkerContext } from '../../context';
import type { TaskTransitions } from '../../services/task-transitions';
import type { PersistedWorkflowState } from '../state';

export interface StepExecutionContext {
  worker: WorkerContext;
  transitions: TaskTransitions;
  run: WorkflowRun;
  step: WorkflowStep;
  definition: WorkflowStepDefinition;
  task: Task & {
    repository: Repository | null;
    project: { id: string; organizationId: string; maxReviewCycles: number };
  };
  state: PersistedWorkflowState;
  traceId: string;
  logger: EngLoopLogger;
}

export interface StepOutcome {
  status: RunStatus;
  output?: unknown;
  error?: string;
  /** Shallow-merged into the persisted workflow state. */
  patch?: Partial<PersistedWorkflowState>;
}

export type StepHandler = (context: StepExecutionContext) => Promise<StepOutcome>;

export type StepHandlerMap = Partial<Record<WorkflowStepKey, StepHandler>>;
