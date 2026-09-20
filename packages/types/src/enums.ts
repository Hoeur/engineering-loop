/**
 * Single source of truth for EngLoop's domain vocabulary.
 *
 * These are plain const objects (not TS `enum`s) so the values stay structurally
 * comparable with Prisma's generated enums, are tree-shakeable in the browser and
 * can be iterated at runtime. `packages/db` ships a test that asserts every member
 * here exists in `schema.prisma`, so the two can never silently drift.
 */

const asConst = <const T extends Record<string, string>>(value: T): Readonly<T> =>
  Object.freeze(value);

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

export const TaskStatus = asConst({
  BACKLOG: 'BACKLOG',
  PLANNING: 'PLANNING',
  PLAN_READY: 'PLAN_READY',
  QUEUED: 'QUEUED',
  IMPLEMENTING: 'IMPLEMENTING',
  IMPLEMENTATION_READY: 'IMPLEMENTATION_READY',
  TESTING: 'TESTING',
  TEST_FAILED: 'TEST_FAILED',
  REVIEWING: 'REVIEWING',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  FIXING: 'FIXING',
  APPROVED: 'APPROVED',
  PR_READY: 'PR_READY',
  PR_CREATED: 'PR_CREATED',
  MERGED: 'MERGED',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  NEEDS_HUMAN_REVIEW: 'NEEDS_HUMAN_REVIEW',
});
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskType = asConst({
  FEATURE: 'FEATURE',
  BUG: 'BUG',
  REFACTOR: 'REFACTOR',
  TEST: 'TEST',
  DOCUMENTATION: 'DOCUMENTATION',
  SECURITY: 'SECURITY',
  PERFORMANCE: 'PERFORMANCE',
  UI: 'UI',
  DEVOPS: 'DEVOPS',
  INVESTIGATION: 'INVESTIGATION',
});
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const Priority = asConst({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});
export type Priority = (typeof Priority)[keyof typeof Priority];

export const RiskLevel = asConst({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const Severity = asConst({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
});
export type Severity = (typeof Severity)[keyof typeof Severity];

export const TaskDependencyType = asConst({
  BLOCKS: 'BLOCKS',
  RELATES_TO: 'RELATES_TO',
  DUPLICATES: 'DUPLICATES',
});
export type TaskDependencyType = (typeof TaskDependencyType)[keyof typeof TaskDependencyType];

// --------------------------------------------------------------------------
// Agents
// --------------------------------------------------------------------------

export const AgentRole = asConst({
  PRODUCT: 'PRODUCT',
  ARCHITECT: 'ARCHITECT',
  PLANNER: 'PLANNER',
  IMPLEMENTER: 'IMPLEMENTER',
  BACKEND_DEVELOPER: 'BACKEND_DEVELOPER',
  FRONTEND_DEVELOPER: 'FRONTEND_DEVELOPER',
  DATABASE_ENGINEER: 'DATABASE_ENGINEER',
  DEVOPS_ENGINEER: 'DEVOPS_ENGINEER',
  QA: 'QA',
  UI_REVIEWER: 'UI_REVIEWER',
  CODE_REVIEWER: 'CODE_REVIEWER',
  SECURITY_REVIEWER: 'SECURITY_REVIEWER',
  PERFORMANCE_REVIEWER: 'PERFORMANCE_REVIEWER',
  DOCUMENTATION: 'DOCUMENTATION',
});
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const AgentProviderKind = asConst({
  CODEX: 'CODEX',
  CLAUDE_CODE: 'CLAUDE_CODE',
  GEMINI: 'GEMINI',
  OPENAI_API: 'OPENAI_API',
  ANTHROPIC_API: 'ANTHROPIC_API',
  LOCAL_LLM: 'LOCAL_LLM',
  CUSTOM_CLI: 'CUSTOM_CLI',
  MOCK: 'MOCK',
});
export type AgentProviderKind = (typeof AgentProviderKind)[keyof typeof AgentProviderKind];

export const AgentRunStatus = asConst({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
});
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

export const AgentMessageRole = asConst({
  SYSTEM: 'SYSTEM',
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
  TOOL: 'TOOL',
});
export type AgentMessageRole = (typeof AgentMessageRole)[keyof typeof AgentMessageRole];

// --------------------------------------------------------------------------
// Workflow
// --------------------------------------------------------------------------

export const WorkflowStepKey = asConst({
  ANALYZE_REPOSITORY: 'ANALYZE_REPOSITORY',
  PLAN: 'PLAN',
  CREATE_TASKS: 'CREATE_TASKS',
  CREATE_WORKTREE: 'CREATE_WORKTREE',
  IMPLEMENT: 'IMPLEMENT',
  RUN_TESTS: 'RUN_TESTS',
  UI_QA: 'UI_QA',
  REVIEW: 'REVIEW',
  FIX: 'FIX',
  RETEST: 'RETEST',
  FINAL_REVIEW: 'FINAL_REVIEW',
  DOCUMENT: 'DOCUMENT',
  PREPARE_PR: 'PREPARE_PR',
  COMPLETE: 'COMPLETE',
});
export type WorkflowStepKey = (typeof WorkflowStepKey)[keyof typeof WorkflowStepKey];

export const RunStatus = asConst({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SKIPPED: 'SKIPPED',
  WAITING_FOR_HUMAN: 'WAITING_FOR_HUMAN',
});
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

// --------------------------------------------------------------------------
// Testing
// --------------------------------------------------------------------------

export const CheckType = asConst({
  LINT: 'LINT',
  TYPECHECK: 'TYPECHECK',
  UNIT: 'UNIT',
  INTEGRATION: 'INTEGRATION',
  BUILD: 'BUILD',
  E2E: 'E2E',
  SECURITY: 'SECURITY',
  CUSTOM: 'CUSTOM',
});
export type CheckType = (typeof CheckType)[keyof typeof CheckType];

export const CheckStatus = asConst({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  TIMEOUT: 'TIMEOUT',
});
export type CheckStatus = (typeof CheckStatus)[keyof typeof CheckStatus];

// --------------------------------------------------------------------------
// Review
// --------------------------------------------------------------------------

export const ReviewDecision = asConst({
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  COMMENTED: 'COMMENTED',
  FAILED: 'FAILED',
});
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

export const ReviewCategory = asConst({
  CORRECTNESS: 'CORRECTNESS',
  ARCHITECTURE: 'ARCHITECTURE',
  SECURITY: 'SECURITY',
  PERFORMANCE: 'PERFORMANCE',
  TESTING: 'TESTING',
  MAINTAINABILITY: 'MAINTAINABILITY',
  UI: 'UI',
  ACCESSIBILITY: 'ACCESSIBILITY',
  DOCUMENTATION: 'DOCUMENTATION',
});
export type ReviewCategory = (typeof ReviewCategory)[keyof typeof ReviewCategory];

export const FindingStatus = asConst({
  OPEN: 'OPEN',
  FIXING: 'FIXING',
  RESOLVED: 'RESOLVED',
  WONT_FIX: 'WONT_FIX',
  ACCEPTED_RISK: 'ACCEPTED_RISK',
});
export type FindingStatus = (typeof FindingStatus)[keyof typeof FindingStatus];

export const ReviewKind = asConst({
  CODE: 'CODE',
  SECURITY: 'SECURITY',
  PERFORMANCE: 'PERFORMANCE',
  UI: 'UI',
  ARCHITECTURE: 'ARCHITECTURE',
});
export type ReviewKind = (typeof ReviewKind)[keyof typeof ReviewKind];

// --------------------------------------------------------------------------
// UI QA
// --------------------------------------------------------------------------

export const Viewport = asConst({
  DESKTOP: 'DESKTOP',
  TABLET: 'TABLET',
  MOBILE: 'MOBILE',
});
export type Viewport = (typeof Viewport)[keyof typeof Viewport];

export const VIEWPORT_PRESETS: Readonly<Record<Viewport, { width: number; height: number }>> =
  Object.freeze({
    DESKTOP: { width: 1440, height: 900 },
    TABLET: { width: 768, height: 1024 },
    MOBILE: { width: 375, height: 812 },
  });

export const UiFindingCategory = asConst({
  LAYOUT: 'LAYOUT',
  SPACING: 'SPACING',
  TYPOGRAPHY: 'TYPOGRAPHY',
  RESPONSIVE: 'RESPONSIVE',
  OVERFLOW: 'OVERFLOW',
  ACCESSIBILITY: 'ACCESSIBILITY',
  CONTRAST: 'CONTRAST',
  NAVIGATION: 'NAVIGATION',
  EMPTY_STATE: 'EMPTY_STATE',
  LOADING_STATE: 'LOADING_STATE',
  ERROR_STATE: 'ERROR_STATE',
  INTERACTION: 'INTERACTION',
  CONSOLE_ERROR: 'CONSOLE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
});
export type UiFindingCategory = (typeof UiFindingCategory)[keyof typeof UiFindingCategory];

// --------------------------------------------------------------------------
// Repositories / Git / PRs
// --------------------------------------------------------------------------

export const RepositoryProvider = asConst({
  GITHUB: 'GITHUB',
  GITLAB: 'GITLAB',
  BITBUCKET: 'BITBUCKET',
  LOCAL: 'LOCAL',
});
export type RepositoryProvider = (typeof RepositoryProvider)[keyof typeof RepositoryProvider];

export const RepositoryStatus = asConst({
  CONNECTED: 'CONNECTED',
  SYNCING: 'SYNCING',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
});
export type RepositoryStatus = (typeof RepositoryStatus)[keyof typeof RepositoryStatus];

export const PullRequestStatus = asConst({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  MERGED: 'MERGED',
  CLOSED: 'CLOSED',
});
export type PullRequestStatus = (typeof PullRequestStatus)[keyof typeof PullRequestStatus];

export const WorktreeStatus = asConst({
  CREATING: 'CREATING',
  ACTIVE: 'ACTIVE',
  DIRTY: 'DIRTY',
  RELEASED: 'RELEASED',
  ERROR: 'ERROR',
});
export type WorktreeStatus = (typeof WorktreeStatus)[keyof typeof WorktreeStatus];

// --------------------------------------------------------------------------
// Governance
// --------------------------------------------------------------------------

export const PermissionLevel = asConst({
  LEVEL_0_OBSERVE: 'LEVEL_0_OBSERVE',
  LEVEL_1_PLAN: 'LEVEL_1_PLAN',
  LEVEL_2_CODE: 'LEVEL_2_CODE',
  LEVEL_3_PR: 'LEVEL_3_PR',
  LEVEL_4_MERGE: 'LEVEL_4_MERGE',
  LEVEL_5_DEPLOY: 'LEVEL_5_DEPLOY',
});
export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

/** Ordered from least to most privileged; used for `>=` comparisons. */
export const PERMISSION_LEVEL_ORDER: readonly PermissionLevel[] = Object.freeze([
  PermissionLevel.LEVEL_0_OBSERVE,
  PermissionLevel.LEVEL_1_PLAN,
  PermissionLevel.LEVEL_2_CODE,
  PermissionLevel.LEVEL_3_PR,
  PermissionLevel.LEVEL_4_MERGE,
  PermissionLevel.LEVEL_5_DEPLOY,
]);

export const OrgRole = asConst({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MAINTAINER: 'MAINTAINER',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
});
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

export const ApprovalStatus = asConst({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalKind = asConst({
  PLAN: 'PLAN',
  IMPLEMENTATION: 'IMPLEMENTATION',
  PULL_REQUEST: 'PULL_REQUEST',
  MERGE: 'MERGE',
  DEPLOY: 'DEPLOY',
  BUDGET_OVERRIDE: 'BUDGET_OVERRIDE',
});
export type ApprovalKind = (typeof ApprovalKind)[keyof typeof ApprovalKind];

// --------------------------------------------------------------------------
// Platform
// --------------------------------------------------------------------------

export const ScheduleType = asConst({
  REPOSITORY_REVIEW: 'REPOSITORY_REVIEW',
  TECH_DEBT_ANALYSIS: 'TECH_DEBT_ANALYSIS',
  SECURITY_SCAN: 'SECURITY_SCAN',
  DEPENDENCY_REVIEW: 'DEPENDENCY_REVIEW',
  TEST_SUITE: 'TEST_SUITE',
  BACKLOG_ANALYSIS: 'BACKLOG_ANALYSIS',
  ARCHITECTURE_REVIEW: 'ARCHITECTURE_REVIEW',
  UI_QUALITY_REVIEW: 'UI_QUALITY_REVIEW',
  TASK_EXECUTION: 'TASK_EXECUTION',
});
export type ScheduleType = (typeof ScheduleType)[keyof typeof ScheduleType];

export const ArtifactKind = asConst({
  DIFF: 'DIFF',
  LOG: 'LOG',
  REPORT: 'REPORT',
  SCREENSHOT: 'SCREENSHOT',
  COVERAGE: 'COVERAGE',
  PLAN: 'PLAN',
  TRACE: 'TRACE',
  OTHER: 'OTHER',
});
export type ArtifactKind = (typeof ArtifactKind)[keyof typeof ArtifactKind];

export const NotificationType = asConst({
  TASK_FAILED: 'TASK_FAILED',
  TEST_FAILED: 'TEST_FAILED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  HUMAN_APPROVAL_REQUIRED: 'HUMAN_APPROVAL_REQUIRED',
  AGENT_FAILED: 'AGENT_FAILED',
  PR_READY: 'PR_READY',
  COST_LIMIT_REACHED: 'COST_LIMIT_REACHED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
});
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = asConst({
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SLACK: 'SLACK',
  WEBHOOK: 'WEBHOOK',
});
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const AuditAction = asConst({
  AGENT_STARTED: 'AGENT_STARTED',
  AGENT_STOPPED: 'AGENT_STOPPED',
  COMMAND_EXECUTED: 'COMMAND_EXECUTED',
  TASK_TRANSITIONED: 'TASK_TRANSITIONED',
  GIT_ACTION: 'GIT_ACTION',
  APPROVAL_DECISION: 'APPROVAL_DECISION',
  REVIEW_DECISION: 'REVIEW_DECISION',
  CONFIGURATION_CHANGED: 'CONFIGURATION_CHANGED',
  SCHEDULE_CHANGED: 'SCHEDULE_CHANGED',
  SECRET_ACCESSED: 'SECRET_ACCESSED',
});
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ArchitectureDecisionStatus = asConst({
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  DEPRECATED: 'DEPRECATED',
  SUPERSEDED: 'SUPERSEDED',
});
export type ArchitectureDecisionStatus =
  (typeof ArchitectureDecisionStatus)[keyof typeof ArchitectureDecisionStatus];

export const MemoryKind = asConst({
  ARCHITECTURE: 'ARCHITECTURE',
  TECH_STACK: 'TECH_STACK',
  CONVENTIONS: 'CONVENTIONS',
  API_CONVENTIONS: 'API_CONVENTIONS',
  UI_CONVENTIONS: 'UI_CONVENTIONS',
  TEST_COMMANDS: 'TEST_COMMANDS',
  DEPLOYMENT: 'DEPLOYMENT',
  TECH_DEBT: 'TECH_DEBT',
  KNOWN_BUGS: 'KNOWN_BUGS',
  COMPLETED_FEATURES: 'COMPLETED_FEATURES',
  IMPORTANT_MODULES: 'IMPORTANT_MODULES',
  DECISIONS: 'DECISIONS',
});
export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const EpicStatus = asConst({
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
});
export type EpicStatus = (typeof EpicStatus)[keyof typeof EpicStatus];

export const ProjectStatus = asConst({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
});
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const WebhookEventStatus = asConst({
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  IGNORED: 'IGNORED',
});
export type WebhookEventStatus = (typeof WebhookEventStatus)[keyof typeof WebhookEventStatus];

/** Every enum object exported above, keyed by its Prisma enum name. */
export const DOMAIN_ENUMS = Object.freeze({
  TaskStatus,
  TaskType,
  Priority,
  RiskLevel,
  Severity,
  TaskDependencyType,
  AgentRole,
  AgentProviderKind,
  AgentRunStatus,
  AgentMessageRole,
  WorkflowStepKey,
  RunStatus,
  CheckType,
  CheckStatus,
  ReviewDecision,
  ReviewCategory,
  FindingStatus,
  ReviewKind,
  Viewport,
  UiFindingCategory,
  RepositoryProvider,
  RepositoryStatus,
  PullRequestStatus,
  WorktreeStatus,
  PermissionLevel,
  OrgRole,
  ApprovalStatus,
  ApprovalKind,
  ScheduleType,
  ArtifactKind,
  NotificationType,
  NotificationChannel,
  AuditAction,
  ArchitectureDecisionStatus,
  MemoryKind,
  EpicStatus,
  ProjectStatus,
  WebhookEventStatus,
});
