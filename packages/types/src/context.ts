/**
 * Correlation context threaded through every log line, audit record and queue job.
 * Section 49 of the platform spec: engineering execution logs must always carry
 * the identifiers needed to reconstruct a run.
 */
export interface ExecutionContext {
  traceId: string;
  requestId?: string;
  organizationId?: string;
  projectId?: string;
  repositoryId?: string;
  taskId?: string;
  taskKey?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  agentRunId?: string;
  actorId?: string;
  actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'SCHEDULE';
}

export type PartialExecutionContext = Partial<ExecutionContext>;

export interface Actor {
  id: string;
  type: NonNullable<ExecutionContext['actorType']>;
  displayName: string;
}
