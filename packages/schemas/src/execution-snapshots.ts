import { z } from 'zod';
import { plannerPhaseContextSchema } from './agent-contracts';
import {
  cuidLike,
  zAgentProviderKind,
  zAgentRole,
  zPermissionLevel,
  zTaskType,
  zPriority,
  zRiskLevel,
  zCheckType,
  zMemoryKind,
  zRepositoryProvider,
} from './common';
import { promptRoleSchema } from './prompt-templates';

export const executionSelectionSchema = z
  .object({
    prompts: z
      .array(
        z
          .object({
            role: promptRoleSchema,
            templateId: cuidLike,
            revision: z.number().int().positive().max(2147483647),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.prompts.map((prompt) => prompt.role)).size !== value.prompts.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select at most one prompt per role' });
  });
export type ExecutionSelection = z.infer<typeof executionSelectionSchema>;

export const executionPreviewRequestSchema = z
  .object({
    mode: z.enum(['plan', 'run']),
    skipPlanning: z.boolean().default(false),
    execution: executionSelectionSchema.default({}),
  })
  .strict()
  .refine((input) => input.mode !== 'plan' || !input.skipPlanning, {
    message: 'Planning cannot skip the planner',
  });
export type ExecutionPreviewRequest = z.infer<typeof executionPreviewRequestSchema>;

export const executionRoleSnapshotSchema = z
  .object({
    role: zAgentRole,
    agentId: cuidLike.nullable(),
    providerId: cuidLike,
    providerKey: z.string().min(1),
    providerKind: zAgentProviderKind,
    model: z.string().min(1).nullable(),
    agentUpdatedAt: z.string().datetime().optional(),
    providerUpdatedAt: z.string().datetime(),
    configurationVersions: z.array(
      z.object({ id: cuidLike, version: z.number().int().positive() }).strict(),
    ),
    systemPrompt: z.string().nullable(),
    budget: z
      .object({
        timeoutMs: z.number().int().positive(),
        maxTokens: z.number().int().positive(),
        maxCostUsd: z.number().nonnegative(),
        allowedCommands: z.array(z.string()),
      })
      .strict(),
    permissionLevel: zPermissionLevel,
    prompt: z
      .object({
        templateId: cuidLike,
        revision: z.number().int().positive(),
        body: z.string(),
        rendered: z.string().max(100000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ExecutionRoleSnapshot = z.infer<typeof executionRoleSnapshotSchema>;

// Keep browser previews independent from secret-bearing configuration and invocation context.
export const executionPreviewSchema = z.object({
  capturedAt: z.string().datetime(),
  taskId: cuidLike,
  roles: z.array(
    executionRoleSnapshotSchema
      .pick({
        role: true,
        agentId: true,
        providerKey: true,
        providerKind: true,
        model: true,
        permissionLevel: true,
        budget: true,
        prompt: true,
      })
      .strip(),
  ),
});
export type ExecutionPreview = z.infer<typeof executionPreviewSchema>;

export const workflowExecutionSnapshotSchema = z
  .object({
    version: z.literal(1),
    organizationId: cuidLike,
    projectId: cuidLike,
    taskId: cuidLike,
    capturedAt: z.string().datetime(),
    task: z
      .object({
        id: cuidLike,
        key: z.string(),
        title: z.string(),
        description: z.string(),
        objective: z.string(),
        type: zTaskType,
        priority: zPriority,
        riskLevel: zRiskLevel,
        acceptanceCriteria: z.array(z.string()),
        implementationNotes: z.array(z.string()),
        suggestedFiles: z.array(z.string()),
        requiredChecks: z.array(zCheckType),
        phaseId: cuidLike.nullable(),
        ownerRole: zAgentRole.nullable(),
        maxAttempts: z.number().int().positive(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
    project: z
      .object({
        id: cuidLike,
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable(),
        permissionLevel: zPermissionLevel,
        maxReviewCycles: z.number().int().positive(),
        costBudgetUsd: z.number().nonnegative(),
        uiQaEnabled: z.boolean(),
        documentationEnabled: z.boolean(),
        teamVersion: z.number().int().nonnegative(),
      })
      .strict(),
    repository: z
      .object({
        id: cuidLike,
        provider: zRepositoryProvider,
        name: z.string(),
        defaultBranch: z.string(),
        primaryLanguage: z.string().nullable(),
        frameworks: z.array(z.string()),
        packageManager: z.string(),
        commands: z.record(z.string()),
      })
      .strict()
      .nullable(),
    memories: z.array(
      z
        .object({
          id: cuidLike,
          kind: zMemoryKind,
          version: z.number().int().positive(),
          content: z.string(),
        })
        .strict(),
    ),
    phaseContext: plannerPhaseContextSchema.optional(),
    roles: z.array(executionRoleSnapshotSchema).min(1),
    artifacts: z.array(
      z
        .object({
          id: cuidLike,
          kind: z.string(),
          createdAt: z.string().datetime(),
          contentHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.projectId !== snapshot.project.id || snapshot.taskId !== snapshot.task.id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Snapshot ownership identifiers must match',
      });
    if (new Set(snapshot.roles.map((role) => role.role)).size !== snapshot.roles.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Snapshot roles must be unique' });
    if (snapshot.phaseContext && snapshot.phaseContext.phaseId !== snapshot.task.phaseId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Snapshot phase must match task phase',
      });
  });
export type WorkflowExecutionSnapshot = z.infer<typeof workflowExecutionSnapshotSchema>;
