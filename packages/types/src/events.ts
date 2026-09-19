import type { ExecutionContext } from './context';
import type {
  AgentRole,
  CheckStatus,
  ReviewDecision,
  RunStatus,
  TaskStatus,
  WorkflowStepKey,
} from './enums';

/** Every internal domain event name (spec section 19). */
export const DomainEventName = Object.freeze({
  PROJECT_CREATED: 'project.created',
  REPOSITORY_CONNECTED: 'repository.connected',

  TASK_CREATED: 'task.created',
  TASK_PLANNING_STARTED: 'task.planning.started',
  TASK_PLAN_READY: 'task.plan.ready',
  TASK_IMPLEMENTATION_STARTED: 'task.implementation.started',
  TASK_IMPLEMENTATION_COMPLETED: 'task.implementation.completed',
  TASK_TESTING_STARTED: 'task.testing.started',
  TASK_TESTING_FAILED: 'task.testing.failed',
  TASK_TESTING_PASSED: 'task.testing.passed',
  TASK_REVIEW_STARTED: 'task.review.started',
  TASK_REVIEW_CHANGES_REQUESTED: 'task.review.changes_requested',
  TASK_REVIEW_APPROVED: 'task.review.approved',
  TASK_FIX_STARTED: 'task.fix.started',
  TASK_FIX_COMPLETED: 'task.fix.completed',
  TASK_STATUS_CHANGED: 'task.status.changed',
  TASK_NEEDS_HUMAN_REVIEW: 'task.needs_human_review',

  AGENT_STARTED: 'agent.started',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',

  WORKTREE_CREATED: 'worktree.created',
  WORKTREE_RELEASED: 'worktree.released',
  COMMIT_CREATED: 'commit.created',
  PULL_REQUEST_CREATED: 'pull_request.created',
  PULL_REQUEST_MERGED: 'pull_request.merged',

  SCHEDULE_TRIGGERED: 'schedule.triggered',

  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_STEP_STARTED: 'workflow.step.started',
  WORKFLOW_STEP_COMPLETED: 'workflow.step.completed',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',

  COST_LIMIT_REACHED: 'cost.limit.reached',
});
export type DomainEventName = (typeof DomainEventName)[keyof typeof DomainEventName];

interface EventEnvelope<TName extends DomainEventName, TPayload> {
  id: string;
  name: TName;
  occurredAt: string;
  context: ExecutionContext;
  payload: TPayload;
}

/**
 * Distributes over the name union so that an event declared with several names
 * becomes a union of single-name envelopes. Without this, `Extract<DomainEvent,
 * { name: 'task.plan.ready' }>` collapses to `never` and handlers lose their
 * payload types.
 */
type EventEnvelopeUnion<TNames extends DomainEventName, TPayload> = TNames extends DomainEventName
  ? EventEnvelope<TNames, TPayload>
  : never;

export type ProjectCreatedEvent = EventEnvelope<
  typeof DomainEventName.PROJECT_CREATED,
  { projectId: string; name: string; slug: string }
>;

export type RepositoryConnectedEvent = EventEnvelope<
  typeof DomainEventName.REPOSITORY_CONNECTED,
  { repositoryId: string; projectId: string; provider: string; defaultBranch: string }
>;

export type TaskCreatedEvent = EventEnvelope<
  typeof DomainEventName.TASK_CREATED,
  { taskId: string; taskKey: string; title: string; createdBy: string }
>;

export type TaskStatusChangedEvent = EventEnvelope<
  typeof DomainEventName.TASK_STATUS_CHANGED,
  { taskId: string; taskKey: string; from: TaskStatus; to: TaskStatus; reason?: string }
>;

export type TaskLifecycleEvent = EventEnvelopeUnion<
  | typeof DomainEventName.TASK_PLANNING_STARTED
  | typeof DomainEventName.TASK_PLAN_READY
  | typeof DomainEventName.TASK_IMPLEMENTATION_STARTED
  | typeof DomainEventName.TASK_IMPLEMENTATION_COMPLETED
  | typeof DomainEventName.TASK_TESTING_STARTED
  | typeof DomainEventName.TASK_FIX_STARTED
  | typeof DomainEventName.TASK_FIX_COMPLETED
  | typeof DomainEventName.TASK_NEEDS_HUMAN_REVIEW,
  { taskId: string; taskKey: string; attempt: number }
>;

export type TaskTestingResultEvent = EventEnvelopeUnion<
  typeof DomainEventName.TASK_TESTING_PASSED | typeof DomainEventName.TASK_TESTING_FAILED,
  { taskId: string; testRunId: string; status: CheckStatus; failedChecks: string[] }
>;

export type TaskReviewEvent = EventEnvelopeUnion<
  | typeof DomainEventName.TASK_REVIEW_STARTED
  | typeof DomainEventName.TASK_REVIEW_APPROVED
  | typeof DomainEventName.TASK_REVIEW_CHANGES_REQUESTED,
  { taskId: string; reviewRunId: string; decision?: ReviewDecision; findingCount?: number }
>;

export type AgentLifecycleEvent = EventEnvelopeUnion<
  | typeof DomainEventName.AGENT_STARTED
  | typeof DomainEventName.AGENT_COMPLETED
  | typeof DomainEventName.AGENT_FAILED,
  {
    agentRunId: string;
    role: AgentRole;
    provider: string;
    model?: string;
    durationMs?: number;
    error?: string;
  }
>;

export type WorktreeEvent = EventEnvelopeUnion<
  typeof DomainEventName.WORKTREE_CREATED | typeof DomainEventName.WORKTREE_RELEASED,
  { worktreeId: string; path: string; branch: string; taskId: string }
>;

export type CommitCreatedEvent = EventEnvelope<
  typeof DomainEventName.COMMIT_CREATED,
  { commitId: string; sha: string; message: string; filesChanged: number }
>;

export type PullRequestEvent = EventEnvelopeUnion<
  typeof DomainEventName.PULL_REQUEST_CREATED | typeof DomainEventName.PULL_REQUEST_MERGED,
  { pullRequestId: string; number: number | null; url: string | null; branch: string }
>;

export type ScheduleTriggeredEvent = EventEnvelope<
  typeof DomainEventName.SCHEDULE_TRIGGERED,
  { scheduleId: string; scheduleType: string; firedAt: string }
>;

export type WorkflowEvent = EventEnvelopeUnion<
  | typeof DomainEventName.WORKFLOW_STARTED
  | typeof DomainEventName.WORKFLOW_COMPLETED
  | typeof DomainEventName.WORKFLOW_FAILED,
  { workflowRunId: string; definitionKey: string; status: RunStatus; error?: string }
>;

export type WorkflowStepEvent = EventEnvelopeUnion<
  typeof DomainEventName.WORKFLOW_STEP_STARTED | typeof DomainEventName.WORKFLOW_STEP_COMPLETED,
  { workflowRunId: string; stepKey: WorkflowStepKey; attempt: number; status: RunStatus }
>;

export type CostLimitReachedEvent = EventEnvelope<
  typeof DomainEventName.COST_LIMIT_REACHED,
  {
    scope: 'TASK' | 'PROJECT' | 'ORGANIZATION';
    scopeId: string;
    limitUsd: number;
    spentUsd: number;
  }
>;

export type DomainEvent =
  | ProjectCreatedEvent
  | RepositoryConnectedEvent
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskLifecycleEvent
  | TaskTestingResultEvent
  | TaskReviewEvent
  | AgentLifecycleEvent
  | WorktreeEvent
  | CommitCreatedEvent
  | PullRequestEvent
  | ScheduleTriggeredEvent
  | WorkflowEvent
  | WorkflowStepEvent
  | CostLimitReachedEvent;

export type DomainEventOf<TName extends DomainEventName> = Extract<DomainEvent, { name: TName }>;

export type DomainEventHandler<TName extends DomainEventName = DomainEventName> = (
  event: DomainEventOf<TName>,
) => void | Promise<void>;
