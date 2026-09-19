import { TaskStatus } from '@engloop/types';
import { StateMachine, type StateMachineDefinition } from './state-machine';

/**
 * The only legal task transitions in EngLoop. Nothing in the platform writes
 * `task.status` directly — everything routes through TasksService.transition,
 * which consults this machine first.
 */
export const TASK_STATE_MACHINE_DEFINITION: StateMachineDefinition<TaskStatus> = {
  name: 'Task',
  initial: TaskStatus.BACKLOG,
  terminal: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
  transitions: {
    BACKLOG: ['PLANNING', 'QUEUED', 'BLOCKED', 'CANCELLED'],
    PLANNING: ['PLAN_READY', 'FAILED', 'BLOCKED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW'],
    PLAN_READY: ['QUEUED', 'BACKLOG', 'BLOCKED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW'],
    QUEUED: ['IMPLEMENTING', 'BLOCKED', 'CANCELLED', 'FAILED'],
    IMPLEMENTING: ['IMPLEMENTATION_READY', 'FAILED', 'BLOCKED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW'],
    IMPLEMENTATION_READY: ['TESTING', 'BLOCKED', 'CANCELLED', 'FAILED'],
    TESTING: ['TEST_FAILED', 'REVIEWING', 'FAILED', 'CANCELLED'],
    TEST_FAILED: ['FIXING', 'NEEDS_HUMAN_REVIEW', 'BLOCKED', 'CANCELLED', 'FAILED'],
    REVIEWING: ['APPROVED', 'CHANGES_REQUESTED', 'FAILED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW'],
    CHANGES_REQUESTED: ['FIXING', 'NEEDS_HUMAN_REVIEW', 'BLOCKED', 'CANCELLED'],
    FIXING: ['IMPLEMENTATION_READY', 'TESTING', 'FAILED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW'],
    APPROVED: ['PR_READY', 'COMPLETED', 'CANCELLED'],
    PR_READY: ['PR_CREATED', 'FAILED', 'CANCELLED'],
    PR_CREATED: ['MERGED', 'CHANGES_REQUESTED', 'CANCELLED', 'FAILED'],
    MERGED: ['COMPLETED'],
    COMPLETED: [],
    BLOCKED: ['BACKLOG', 'PLANNING', 'QUEUED', 'CANCELLED'],
    FAILED: ['BACKLOG', 'QUEUED', 'PLANNING', 'NEEDS_HUMAN_REVIEW', 'CANCELLED'],
    CANCELLED: [],
    NEEDS_HUMAN_REVIEW: ['FIXING', 'APPROVED', 'QUEUED', 'BACKLOG', 'BLOCKED', 'CANCELLED'],
  },
};

export const taskStateMachine = new StateMachine<TaskStatus>(TASK_STATE_MACHINE_DEFINITION);

/** Statuses that mean "an agent or check is currently doing something". */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  TaskStatus.PLANNING,
  TaskStatus.QUEUED,
  TaskStatus.IMPLEMENTING,
  TaskStatus.TESTING,
  TaskStatus.REVIEWING,
  TaskStatus.FIXING,
  TaskStatus.PR_READY,
]);

/** Statuses that require a human before the loop can continue. */
export const HUMAN_ATTENTION_STATUSES: readonly TaskStatus[] = Object.freeze([
  TaskStatus.NEEDS_HUMAN_REVIEW,
  TaskStatus.CHANGES_REQUESTED,
  TaskStatus.TEST_FAILED,
  TaskStatus.BLOCKED,
  TaskStatus.FAILED,
]);

/** Board column mapping used by the Kanban view (spec section 26). */
export const BOARD_COLUMNS = Object.freeze([
  { id: 'backlog', title: 'Backlog', statuses: [TaskStatus.BACKLOG] },
  { id: 'planned', title: 'Planned', statuses: [TaskStatus.PLANNING, TaskStatus.PLAN_READY] },
  { id: 'queued', title: 'Queued', statuses: [TaskStatus.QUEUED] },
  {
    id: 'in-progress',
    title: 'In Progress',
    statuses: [TaskStatus.IMPLEMENTING, TaskStatus.IMPLEMENTATION_READY],
  },
  { id: 'testing', title: 'Testing', statuses: [TaskStatus.TESTING, TaskStatus.TEST_FAILED] },
  {
    id: 'review',
    title: 'Review',
    statuses: [TaskStatus.REVIEWING, TaskStatus.NEEDS_HUMAN_REVIEW],
  },
  {
    id: 'changes-requested',
    title: 'Changes Requested',
    statuses: [TaskStatus.CHANGES_REQUESTED, TaskStatus.FIXING],
  },
  {
    id: 'approved',
    title: 'Approved',
    statuses: [TaskStatus.APPROVED, TaskStatus.PR_READY, TaskStatus.PR_CREATED, TaskStatus.MERGED],
  },
  { id: 'completed', title: 'Completed', statuses: [TaskStatus.COMPLETED] },
  {
    id: 'blocked',
    title: 'Blocked',
    statuses: [TaskStatus.BLOCKED, TaskStatus.FAILED, TaskStatus.CANCELLED],
  },
] as const);

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const columnForStatus = (status: TaskStatus): BoardColumn['id'] =>
  BOARD_COLUMNS.find((column) => (column.statuses as readonly TaskStatus[]).includes(status))?.id ??
  'backlog';
