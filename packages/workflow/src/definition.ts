import {
  type AgentRole,
  PERMISSION_LEVEL_ORDER,
  PermissionLevel,
  type TaskStatus,
  type WorkflowStepKey,
} from '@engloop/types';

export type WorkflowStepKind = 'AGENT' | 'SYSTEM' | 'GIT' | 'HUMAN';

export interface WorkflowStepDefinition {
  key: WorkflowStepKey;
  title: string;
  description: string;
  kind: WorkflowStepKind;
  /** Agent role that executes the step; null for deterministic system steps. */
  role: AgentRole | null;
  /** Task status applied when the step starts. */
  entryStatus: TaskStatus | null;
  maxAttempts: number;
  /** Minimum project permission level required before the step may run. */
  requiredPermission: PermissionLevel;
  optional: boolean;
}

export interface WorkflowDefinition {
  key: string;
  version: number;
  name: string;
  description: string;
  steps: readonly WorkflowStepDefinition[];
  decide: (state: WorkflowState) => WorkflowDecision;
}

export interface WorkflowState {
  /** Steps that finished successfully in this run, in completion order. */
  completedSteps: readonly WorkflowStepKey[];
  /** Steps that failed on their final attempt. */
  failedSteps: readonly WorkflowStepKey[];
  /** How many review→fix→retest cycles have been consumed. */
  reviewCycle: number;
  maxReviewCycles: number;
  /** Implementation attempts consumed (fix attempts included). */
  attempt: number;
  maxAttempts: number;
  testsPassed: boolean;
  /**
   * True when code changed since the last deterministic verification, so the
   * checks must be re-run before the router draws any conclusion from
   * `testsPassed`. This is what turns FIX into FIX → RETEST → REVIEW instead of
   * letting the loop ask for another fix it has not verified.
   */
  verificationPending: boolean;
  reviewApproved: boolean;
  hasBlockingFindings: boolean;
  /**
   * Whether this project runs UI QA at all. Most repositories have no UI, so
   * this defaults to false and the step is skipped entirely — the router only
   * ever sees the resolved boolean, never the project settings it came from,
   * which is what keeps `decideEngineeringStep` free of IO.
   */
  uiQaEnabled: boolean;
  skipPlanning: boolean;
  createPullRequest: boolean;
  permissionLevel: PermissionLevel;
  cancelled: boolean;
}

export type WorkflowDecision =
  | { type: 'RUN_STEP'; step: WorkflowStepDefinition; reason: string }
  | { type: 'COMPLETE'; reason: string }
  | { type: 'FAIL'; reason: string }
  | { type: 'WAIT_FOR_HUMAN'; reason: string }
  | { type: 'CANCELLED'; reason: string };

export const permissionAtLeast = (actual: PermissionLevel, required: PermissionLevel): boolean =>
  PERMISSION_LEVEL_ORDER.indexOf(actual) >= PERMISSION_LEVEL_ORDER.indexOf(required);

export const createInitialWorkflowState = (
  overrides: Partial<WorkflowState> = {},
): WorkflowState => ({
  completedSteps: [],
  failedSteps: [],
  reviewCycle: 0,
  maxReviewCycles: 3,
  attempt: 0,
  maxAttempts: 3,
  testsPassed: false,
  verificationPending: false,
  reviewApproved: false,
  hasBlockingFindings: false,
  uiQaEnabled: false,
  skipPlanning: false,
  createPullRequest: true,
  permissionLevel: PermissionLevel.LEVEL_3_PR,
  cancelled: false,
  ...overrides,
});
