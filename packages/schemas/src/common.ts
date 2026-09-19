import { z } from 'zod';
import {
  AgentRole,
  ApprovalKind,
  ApprovalStatus,
  ArchitectureDecisionStatus,
  ArtifactKind,
  AgentProviderKind,
  CheckStatus,
  CheckType,
  EpicStatus,
  FindingStatus,
  MemoryKind,
  NotificationType,
  OrgRole,
  PermissionLevel,
  Priority,
  ProjectStatus,
  PullRequestStatus,
  RepositoryProvider,
  ReviewCategory,
  ReviewDecision,
  ReviewKind,
  RiskLevel,
  RunStatus,
  ScheduleType,
  Severity,
  TaskDependencyType,
  TaskStatus,
  TaskType,
  UiFindingCategory,
  Viewport,
  WorkflowStepKey,
} from '@engloop/types';

/** Builds a Zod enum from one of the frozen domain-enum objects in @engloop/types. */
export const zEnum = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [T[keyof T], ...T[keyof T][]]);

export const zTaskStatus = zEnum(TaskStatus);
export const zTaskType = zEnum(TaskType);
export const zPriority = zEnum(Priority);
export const zRiskLevel = zEnum(RiskLevel);
export const zSeverity = zEnum(Severity);
export const zTaskDependencyType = zEnum(TaskDependencyType);
export const zAgentRole = zEnum(AgentRole);
export const zAgentProviderKind = zEnum(AgentProviderKind);
export const zWorkflowStepKey = zEnum(WorkflowStepKey);
export const zRunStatus = zEnum(RunStatus);
export const zCheckType = zEnum(CheckType);
export const zCheckStatus = zEnum(CheckStatus);
export const zReviewDecision = zEnum(ReviewDecision);
export const zReviewCategory = zEnum(ReviewCategory);
export const zReviewKind = zEnum(ReviewKind);
export const zFindingStatus = zEnum(FindingStatus);
export const zViewport = zEnum(Viewport);
export const zUiFindingCategory = zEnum(UiFindingCategory);
export const zRepositoryProvider = zEnum(RepositoryProvider);
export const zPullRequestStatus = zEnum(PullRequestStatus);
export const zPermissionLevel = zEnum(PermissionLevel);
export const zOrgRole = zEnum(OrgRole);
export const zApprovalStatus = zEnum(ApprovalStatus);
export const zApprovalKind = zEnum(ApprovalKind);
export const zScheduleType = zEnum(ScheduleType);
export const zArtifactKind = zEnum(ArtifactKind);
export const zNotificationType = zEnum(NotificationType);
export const zMemoryKind = zEnum(MemoryKind);
export const zArchitectureDecisionStatus = zEnum(ArchitectureDecisionStatus);
export const zEpicStatus = zEnum(EpicStatus);
export const zProjectStatus = zEnum(ProjectStatus);

export const cuidLike = z.string().min(1).max(64);
export const taskKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}-\d+$/, 'Task key must look like ENG-101');
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase kebab-case slug');
export const branchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'Invalid git branch name');

export const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(64).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  cachedTokens: z.number().int().min(0).default(0),
  totalTokens: z.number().int().min(0).default(0),
});
export type TokenUsageInput = z.input<typeof tokenUsageSchema>;
