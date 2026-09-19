import { z } from 'zod';
import {
  branchNameSchema,
  cuidLike,
  paginationQuerySchema,
  slugSchema,
  zAgentProviderKind,
  zAgentRole,
  zApprovalKind,
  zCheckType,
  zEpicStatus,
  zFindingStatus,
  zMemoryKind,
  zPermissionLevel,
  zPriority,
  zProjectStatus,
  zRepositoryProvider,
  zRiskLevel,
  zScheduleType,
  zSeverity,
  zTaskDependencyType,
  zTaskStatus,
  zTaskType,
} from './common';

// ---------------------------------------------------------------------------
// Organizations & projects
// ---------------------------------------------------------------------------

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
});
export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const createProjectSchema = z.object({
  organizationId: cuidLike,
  name: z.string().min(2).max(120),
  slug: slugSchema,
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Project key must be uppercase, e.g. ENG'),
  description: z.string().max(2000).optional(),
  permissionLevel: zPermissionLevel.default('LEVEL_3_PR'),
  maxReviewCycles: z.number().int().min(1).max(10).default(3),
  maxTaskAttempts: z.number().int().min(1).max(10).default(3),
  costBudgetUsd: z.number().nonnegative().default(50),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema
  .omit({ organizationId: true, slug: true, key: true })
  .partial()
  .extend({ status: zProjectStatus.optional() });
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidLike.optional(),
  status: zProjectStatus.optional(),
  search: z.string().max(120).optional(),
});

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export const createRepositorySchema = z.object({
  name: z.string().min(1).max(120),
  provider: zRepositoryProvider.default('LOCAL'),
  remoteUrl: z.string().max(500).optional(),
  localPath: z.string().max(500).optional(),
  defaultBranch: z.string().default('main'),
  primaryLanguage: z.string().max(60).optional(),
  frameworks: z.array(z.string().max(60)).default([]),
  packageManager: z.string().max(30).default('pnpm'),
  commands: z.record(z.string()).default({}),
  installationId: z.string().max(60).optional(),
});
export type CreateRepositoryDto = z.infer<typeof createRepositorySchema>;

export const updateRepositorySchema = createRepositorySchema.partial();

export const repositoryCredentialSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(60),
  value: z.string().min(1).max(8000),
});
export type RepositoryCredentialDto = z.infer<typeof repositoryCredentialSchema>;

const githubNumericId = z.string().regex(/^\d+$/, 'GitHub id must contain only digits');

export const githubAuthorizationStartSchema = z.object({}).strict();

export const githubAuthorizationCompleteSchema = z.object({
  code: z.string().min(1).max(500),
  state: z.string().min(20).max(4000),
  // Absent when the user authorized an App that was already installed: every
  // installation the GitHub user can access is connected instead.
  installationId: githubNumericId.optional(),
  setupAction: z.enum(['install', 'update', 'request']).optional(),
});
export type GitHubAuthorizationCompleteDto = z.infer<typeof githubAuthorizationCompleteSchema>;

export const githubImportRepositorySchema = z.object({
  installationId: githubNumericId,
  repositoryId: githubNumericId,
  projectName: z.string().min(2).max(120).optional(),
  projectSlug: slugSchema.optional(),
  projectKey: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]{1,9}$/)
    .optional(),
});
export type GitHubImportRepositoryDto = z.infer<typeof githubImportRepositorySchema>;

// ---------------------------------------------------------------------------
// Epics & features
// ---------------------------------------------------------------------------

export const createEpicSchema = z.object({
  projectId: cuidLike,
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  status: zEpicStatus.default('PLANNED'),
  targetDate: z.string().optional(),
});
export type CreateEpicDto = z.infer<typeof createEpicSchema>;

export const createFeatureSchema = z.object({
  projectId: cuidLike,
  epicId: cuidLike.optional(),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  status: zEpicStatus.default('PLANNED'),
});
export type CreateFeatureDto = z.infer<typeof createFeatureSchema>;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const createTaskSchema = z.object({
  projectId: cuidLike,
  repositoryId: cuidLike.optional(),
  epicId: cuidLike.optional(),
  featureId: cuidLike.optional(),
  parentTaskId: cuidLike.optional(),
  title: z.string().min(3).max(200),
  description: z.string().max(20000).default(''),
  objective: z.string().max(4000).default(''),
  type: zTaskType.default('FEATURE'),
  priority: zPriority.default('MEDIUM'),
  riskLevel: zRiskLevel.default('MEDIUM'),
  acceptanceCriteria: z.array(z.string().max(1000)).default([]),
  implementationNotes: z.array(z.string().max(2000)).default([]),
  suggestedFiles: z.array(z.string().max(500)).default([]),
  requiredChecks: z.array(zCheckType).default([]),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  assignedAgentId: cuidLike.optional(),
  dependsOnTaskIds: z.array(cuidLike).default([]),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema
  .omit({ projectId: true, dependsOnTaskIds: true })
  .partial();
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

/**
 * Status is deliberately NOT part of updateTaskSchema. Transitions go through
 * POST /tasks/:id/transition so the state machine is the only writer.
 */
export const transitionTaskSchema = z.object({
  to: zTaskStatus,
  reason: z.string().max(1000).optional(),
});
export type TransitionTaskDto = z.infer<typeof transitionTaskSchema>;

export const listTasksQuerySchema = paginationQuerySchema.extend({
  projectId: cuidLike.optional(),
  repositoryId: cuidLike.optional(),
  epicId: cuidLike.optional(),
  featureId: cuidLike.optional(),
  status: z.union([zTaskStatus, z.array(zTaskStatus)]).optional(),
  type: zTaskType.optional(),
  priority: zPriority.optional(),
  assignedAgentId: cuidLike.optional(),
  search: z.string().max(200).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const createTaskCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

export const createTaskDependencySchema = z.object({
  dependsOnTaskId: cuidLike,
  type: zTaskDependencyType.default('BLOCKS'),
});

export const planTaskSchema = z.object({
  requirement: z.string().max(20000).optional(),
  constraints: z.array(z.string().max(500)).default([]),
  targetPaths: z.array(z.string().max(500)).default([]),
});
export type PlanTaskDto = z.infer<typeof planTaskSchema>;

export const runTaskSchema = z.object({
  workflowKey: z.string().max(80).default('engineering-task'),
  /** Skips planning when the task already carries acceptance criteria. */
  skipPlanning: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type RunTaskDto = z.infer<typeof runTaskSchema>;

export const approveTaskSchema = z.object({
  note: z.string().max(2000).optional(),
  createPullRequest: z.boolean().default(true),
});

export const retryTaskSchema = z.object({
  fromStep: z.string().max(60).optional(),
  resetAttempts: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const upsertAgentSchema = z.object({
  organizationId: cuidLike,
  projectId: cuidLike.optional(),
  name: z.string().min(2).max(80),
  role: zAgentRole,
  providerKey: z.string().min(1).max(60),
  model: z.string().max(120).optional(),
  enabled: z.boolean().default(true),
  systemPrompt: z.string().max(20000).optional(),
  maxTokens: z.number().int().positive().default(200000),
  maxCostUsd: z.number().nonnegative().default(5),
  timeoutMs: z.number().int().positive().default(900000),
  maxRetries: z.number().int().min(0).max(10).default(2),
  permissionLevel: zPermissionLevel.default('LEVEL_3_PR'),
  allowedCommands: z.array(z.string().max(80)).default([]),
  configuration: z.record(z.unknown()).default({}),
});
export type UpsertAgentDto = z.infer<typeof upsertAgentSchema>;

export const updateAgentSchema = upsertAgentSchema.partial().omit({ organizationId: true });

export const upsertAgentProviderSchema = z
  .object({
    organizationId: cuidLike,
    key: z.string().min(2).max(60),
    displayName: z.string().min(2).max(80),
    kind: zAgentProviderKind,
    enabled: z.boolean().default(true),
    defaultModel: z.string().max(120).optional(),
    availableModels: z.array(z.string().max(120)).default([]),
    /**
     * Provider API key. Never returned by the API — encrypted at rest and only
     * ever echoed back as a redacted preview. Omit to leave a stored key
     * untouched; use `clearCredential` to remove one.
     */
    credential: z.string().min(1).max(8000).optional(),
    /** Removes the stored key, so the provider falls back to its CLI login. */
    clearCredential: z.boolean().default(false),
    configuration: z.record(z.unknown()).default({}),
    pricing: z
      .object({
        inputPerMillionUsd: z.number().nonnegative(),
        outputPerMillionUsd: z.number().nonnegative(),
        cachedPerMillionUsd: z.number().nonnegative().default(0),
      })
      .optional(),
  })
  .refine((value) => !(value.credential && value.clearCredential), {
    message: 'Provide either credential or clearCredential, not both',
    path: ['credential'],
  });
export type UpsertAgentProviderDto = z.infer<typeof upsertAgentProviderSchema>;

export const roleAssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      role: zAgentRole,
      agentId: cuidLike.nullable(),
    }),
  ),
});
export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>;

// ---------------------------------------------------------------------------
// Runs, tests, reviews
// ---------------------------------------------------------------------------

export const listAgentRunsQuerySchema = paginationQuerySchema.extend({
  taskId: cuidLike.optional(),
  projectId: cuidLike.optional(),
  workflowRunId: cuidLike.optional(),
  role: zAgentRole.optional(),
  status: z.string().max(30).optional(),
});

export const listWorkflowRunsQuerySchema = paginationQuerySchema.extend({
  taskId: cuidLike.optional(),
  projectId: cuidLike.optional(),
  status: z.string().max(30).optional(),
});

export const triggerTestRunSchema = z.object({
  checks: z.array(zCheckType).min(1).default(['LINT', 'TYPECHECK', 'UNIT', 'BUILD']),
});

export const triggerReviewSchema = z.object({
  kind: z.enum(['CODE', 'SECURITY', 'PERFORMANCE', 'UI', 'ARCHITECTURE']).default('CODE'),
});

export const updateFindingSchema = z.object({
  status: zFindingStatus,
  resolutionNote: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export const createScheduleSchema = z.object({
  projectId: cuidLike,
  repositoryId: cuidLike.optional(),
  name: z.string().min(2).max(120),
  type: zScheduleType,
  cronExpression: z
    .string()
    .min(9)
    .max(120)
    .regex(/^[\d*/,\-\s?LW#]+$/, 'Invalid cron expression'),
  timezone: z.string().default('UTC'),
  enabled: z.boolean().default(true),
  configuration: z.record(z.unknown()).default({}),
});
export type CreateScheduleDto = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = createScheduleSchema.partial().omit({ projectId: true });

// ---------------------------------------------------------------------------
// Memory & ADRs
// ---------------------------------------------------------------------------

export const upsertProjectMemorySchema = z.object({
  kind: zMemoryKind,
  content: z.string().max(200000),
  metadata: z.record(z.unknown()).default({}),
});
export type UpsertProjectMemoryDto = z.infer<typeof upsertProjectMemorySchema>;

export const createArchitectureDecisionSchema = z.object({
  projectId: cuidLike,
  title: z.string().min(3).max(200),
  context: z.string().min(1).max(20000),
  decision: z.string().min(1).max(20000),
  alternatives: z.array(z.string().max(4000)).default([]),
  consequences: z.array(z.string().max(4000)).default([]),
  status: z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).default('PROPOSED'),
});
export type CreateArchitectureDecisionDto = z.infer<typeof createArchitectureDecisionSchema>;

// ---------------------------------------------------------------------------
// Approvals, PRs, misc
// ---------------------------------------------------------------------------

export const createApprovalSchema = z.object({
  kind: zApprovalKind,
  taskId: cuidLike.optional(),
  workflowRunId: cuidLike.optional(),
  reason: z.string().max(2000).optional(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
});

export const createPullRequestSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().max(60000).optional(),
  baseBranch: branchNameSchema.optional(),
  draft: z.boolean().default(false),
});

export const usageQuerySchema = z.object({
  organizationId: cuidLike.optional(),
  projectId: cuidLike.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(['day', 'project', 'agent', 'provider', 'task']).default('day'),
});
export type UsageQuery = z.infer<typeof usageQuerySchema>;

export const auditQuerySchema = paginationQuerySchema.extend({
  organizationId: cuidLike.optional(),
  projectId: cuidLike.optional(),
  taskId: cuidLike.optional(),
  action: z.string().max(60).optional(),
  actorId: z.string().max(64).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const notificationQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Action inbox
// ---------------------------------------------------------------------------

/**
 * The kinds of decision that can await a person.
 *
 * Full F1 adds MENTION and BUDGET_ALERT; both need work that has not landed
 * (P5 membership validation, and a product decision on what spend is alertable),
 * so the read-only slice aggregates these four.
 */
export const inboxItemType = {
  APPROVAL: 'APPROVAL',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  WORKFLOW_FAILURE: 'WORKFLOW_FAILURE',
  BLOCKING_FINDING: 'BLOCKING_FINDING',
} as const;
export type InboxItemType = (typeof inboxItemType)[keyof typeof inboxItemType];

export const inboxItemSchema = z.object({
  type: z.nativeEnum(inboxItemType),
  /** Id of the underlying record. Items are keyed by (type, sourceId). */
  sourceId: cuidLike,
  projectId: cuidLike,
  projectName: z.string(),
  severity: zSeverity,
  title: z.string(),
  detail: z.string().nullable().default(null),
  taskKey: z.string().nullable().default(null),
  /**
   * The SOURCE record's own timestamp — never the query time, so an item's age
   * does not reset the first time the inbox is opened.
   */
  firstSeenAt: z.string(),
  /** Path to the record this item was derived from. */
  deepLink: z.string(),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const listInboxQuerySchema = z.object({
  projectId: cuidLike.optional(),
  type: z.nativeEnum(inboxItemType).optional(),
  severity: zSeverity.optional(),
});
export type ListInboxQuery = z.infer<typeof listInboxQuerySchema>;
