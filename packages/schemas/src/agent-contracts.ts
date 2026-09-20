import { z } from 'zod';
import {
  branchNameSchema,
  cuidLike,
  taskKeySchema,
  tokenUsageSchema,
  zAgentRole,
  zCheckType,
  zPriority,
  zReviewCategory,
  zRiskLevel,
  zSeverity,
  zTaskType,
  zUiFindingCategory,
  zViewport,
} from './common';

/**
 * Structured agent contracts (spec section 10).
 *
 * Agents talk to EngLoop through these schemas, never through free-form text.
 * Raw model output is parsed with `safeParse` at the adapter boundary; anything
 * that fails validation becomes an AGENT_OUTPUT_INVALID failure rather than
 * silently corrupting workflow state.
 */

// ---------------------------------------------------------------------------
// Shared context handed to every agent
// ---------------------------------------------------------------------------

export const repositoryContextSchema = z.object({
  id: cuidLike,
  name: z.string(),
  provider: z.string(),
  defaultBranch: z.string(),
  primaryLanguage: z.string().nullable().optional(),
  frameworks: z.array(z.string()).default([]),
  packageManager: z.string().nullable().optional(),
  rootPath: z.string().nullable().optional(),
  fileCount: z.number().int().nonnegative().nullable().optional(),
});
export type RepositoryContext = z.infer<typeof repositoryContextSchema>;

export const projectContextSchema = z.object({
  id: cuidLike,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  permissionLevel: z.string(),
});
export type ProjectContext = z.infer<typeof projectContextSchema>;

export const projectMemoryContextSchema = z.object({
  architecture: z.string().nullable().optional(),
  techStack: z.array(z.string()).default([]),
  conventions: z.array(z.string()).default([]),
  apiConventions: z.array(z.string()).default([]),
  uiConventions: z.array(z.string()).default([]),
  testCommands: z.record(z.string()).default({}),
  knownTechDebt: z.array(z.string()).default([]),
  knownBugs: z.array(z.string()).default([]),
  completedFeatures: z.array(z.string()).default([]),
  importantModules: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
});
export type ProjectMemoryContext = z.infer<typeof projectMemoryContextSchema>;

export const repositoryGuidanceSchema = z.object({
  /** Contents of AGENTS.md / CLAUDE.md / .ai/*.md, keyed by relative path. */
  files: z.record(z.string()).default({}),
  truncated: z.array(z.string()).default([]),
});
export type RepositoryGuidance = z.infer<typeof repositoryGuidanceSchema>;

export const agentBudgetSchema = z.object({
  timeoutMs: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative(),
  allowedCommands: z.array(z.string()).default([]),
});
export type AgentBudget = z.infer<typeof agentBudgetSchema>;

export const agentTaskContextSchema = z.object({
  runId: cuidLike,
  role: zAgentRole,
  project: projectContextSchema,
  repository: repositoryContextSchema,
  memory: projectMemoryContextSchema,
  guidance: repositoryGuidanceSchema,
  budget: agentBudgetSchema,
  /** Absolute path of the isolated worktree the agent may modify. */
  workspacePath: z.string(),
  branchName: branchNameSchema.nullable().optional(),
  /** Role-specific payload — one of the *InputSchema shapes below. */
  input: z.unknown(),
  correlation: z
    .object({
      traceId: z.string(),
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      taskId: z.string().optional(),
      workflowRunId: z.string().optional(),
    })
    .passthrough(),
});
export type AgentTaskContext = z.infer<typeof agentTaskContextSchema>;

export const agentContinuationContextSchema = agentTaskContextSchema.extend({
  previousRunId: cuidLike,
  reason: z.string(),
});
export type AgentContinuationContext = z.infer<typeof agentContinuationContextSchema>;

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export const plannerInputSchema = z.object({
  requirement: z.string().min(1),
  objective: z.string().optional(),
  taskType: zTaskType.default('FEATURE'),
  priority: zPriority.default('MEDIUM'),
  constraints: z.array(z.string()).default([]),
  targetPaths: z.array(z.string()).default([]),
});
export type PlannerInput = z.infer<typeof plannerInputSchema>;

export const plannedTaskSchema = z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1),
  description: z.string().default(''),
  type: zTaskType.default('FEATURE'),
  priority: zPriority.default('MEDIUM'),
  riskLevel: zRiskLevel.default('MEDIUM'),
  acceptanceCriteria: z.array(z.string()).default([]),
  implementationNotes: z.array(z.string()).default([]),
  suggestedFiles: z.array(z.string()).default([]),
  requiredChecks: z.array(zCheckType).default([]),
  estimatedTokens: z.number().int().nonnegative().optional(),
  /** Indices into the same `tasks` array that must complete first. */
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
});
export type PlannedTask = z.infer<typeof plannedTaskSchema>;

export const plannerOutputSchema = z.object({
  summary: z.string().min(1),
  approach: z.string().min(1),
  risks: z.array(z.string()).default([]),
  tasks: z.array(plannedTaskSchema).min(1, 'A plan must produce at least one task'),
  acceptanceCriteria: z.array(z.string()).default([]),
  requiredChecks: z.array(zCheckType).default([]),
  dependencies: z.array(z.string()).default([]),
  architectureNotes: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

// ---------------------------------------------------------------------------
// Implementer
// ---------------------------------------------------------------------------

export const implementationInputSchema = z.object({
  taskId: z.string(),
  taskKey: taskKeySchema,
  title: z.string(),
  objective: z.string(),
  description: z.string().default(''),
  acceptanceCriteria: z.array(z.string()).default([]),
  implementationNotes: z.array(z.string()).default([]),
  suggestedFiles: z.array(z.string()).default([]),
  requiredChecks: z.array(zCheckType).default([]),
  /** Present on fix attempts: the findings that must be resolved. */
  fixFindings: z
    .array(
      z.object({
        id: z.string(),
        severity: zSeverity,
        category: zReviewCategory,
        file: z.string().nullable(),
        line: z.number().int().nullable(),
        problem: z.string(),
        requiredFix: z.string(),
      }),
    )
    .default([]),
  /** Present on retest failures: the failing deterministic checks. */
  failedChecks: z
    .array(
      z.object({
        checkType: zCheckType,
        command: z.string(),
        exitCode: z.number().nullable(),
        output: z.string(),
      }),
    )
    .default([]),
  attempt: z.number().int().min(1).default(1),
});
export type ImplementationInput = z.infer<typeof implementationInputSchema>;

export const changedFileSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(['added', 'modified', 'deleted', 'renamed']).default('modified'),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const implementationOutputSchema = z.object({
  taskId: z.string(),
  status: z.enum([
    'implementation_complete',
    'implementation_partial',
    'implementation_blocked',
    'implementation_failed',
  ]),
  summary: z.string().min(1),
  changedFiles: z.array(changedFileSchema).default([]),
  testsAdded: z.array(z.string()).default([]),
  commandsRun: z
    .array(
      z.object({
        command: z.string(),
        exitCode: z.number().nullable(),
        durationMs: z.number().nonnegative().default(0),
      }),
    )
    .default([]),
  commit: z
    .object({
      sha: z.string(),
      message: z.string(),
    })
    .nullable()
    .default(null),
  warnings: z.array(z.string()).default([]),
  blockedReason: z.string().nullable().default(null),
});
export type ImplementationOutput = z.infer<typeof implementationOutputSchema>;

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export const reviewInputSchema = z.object({
  taskId: z.string(),
  taskKey: taskKeySchema,
  title: z.string(),
  objective: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  plannerSummary: z.string().nullable().default(null),
  implementationSummary: z.string().nullable().default(null),
  diff: z.string().default(''),
  diffTruncated: z.boolean().default(false),
  changedFiles: z.array(changedFileSchema).default([]),
  testResults: z
    .array(
      z.object({
        checkType: zCheckType,
        status: z.string(),
        command: z.string(),
        exitCode: z.number().nullable(),
        durationMs: z.number().nonnegative(),
        output: z.string().default(''),
      }),
    )
    .default([]),
  coverage: z
    .object({
      lines: z.number().nullable(),
      statements: z.number().nullable(),
      branches: z.number().nullable(),
      functions: z.number().nullable(),
    })
    .nullable()
    .default(null),
  cycle: z.number().int().min(1).default(1),
  maxCycles: z.number().int().min(1).default(3),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewFindingSchema = z.object({
  severity: zSeverity,
  category: zReviewCategory,
  file: z.string().nullable().default(null),
  line: z.number().int().nonnegative().nullable().default(null),
  problem: z.string().min(1),
  requiredFix: z.string().min(1),
  evidence: z.string().nullable().default(null),
});
export type ReviewFindingPayload = z.infer<typeof reviewFindingSchema>;

export const reviewOutputSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    score: z.number().min(0).max(100).default(0),
    summary: z.string().min(1),
    findings: z.array(reviewFindingSchema).default([]),
    coverageAssessment: z.string().nullable().default(null),
    architectureAssessment: z.string().nullable().default(null),
    securityAssessment: z.string().nullable().default(null),
    performanceAssessment: z.string().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    // A reviewer cannot approve while reporting blocking findings (spec section 43).
    const blocking = value.findings.filter(
      (finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH',
    );
    if (value.decision === 'approved' && blocking.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decision'],
        message: `Cannot approve with ${blocking.length} blocking finding(s)`,
      });
    }
  });
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

// ---------------------------------------------------------------------------
// UI review
// ---------------------------------------------------------------------------

export const uiReviewInputSchema = z.object({
  taskId: z.string(),
  pages: z.array(z.string()).default([]),
  screenshots: z
    .array(
      z.object({
        id: z.string(),
        page: z.string(),
        viewport: zViewport,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        storagePath: z.string(),
      }),
    )
    .default([]),
  consoleErrors: z.array(z.string()).default([]),
  failedRequests: z.array(z.string()).default([]),
});
export type UiReviewInput = z.infer<typeof uiReviewInputSchema>;

export const uiReviewOutputSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  summary: z.string().min(1),
  findings: z
    .array(
      z.object({
        severity: zSeverity,
        category: zUiFindingCategory,
        viewport: zViewport.nullable().default(null),
        page: z.string().nullable().default(null),
        problem: z.string().min(1),
        requiredFix: z.string().min(1),
        screenshotId: z.string().nullable().default(null),
      }),
    )
    .default([]),
});
export type UiReviewOutput = z.infer<typeof uiReviewOutputSchema>;

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

export const documentationInputSchema = z.object({
  taskId: z.string(),
  requirement: z.string(),
  constraints: z.array(z.string()).default([]),
  implementationSummary: z.string().nullable().default(null),
  plannerSummary: z.string().nullable().default(null),
});
export type DocumentationInput = z.infer<typeof documentationInputSchema>;

export const documentationOutputSchema = z.object({
  summary: z.string().min(1),
  /**
   * Documents the agent wrote. `path` is repository-relative and validated
   * against traversal before anything is persisted: the agent chooses what to
   * document, never where on the host it lands.
   */
  documents: z
    .array(
      z.object({
        path: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .default([]),
  /** Things the agent could not document and why — surfaced, not swallowed. */
  gaps: z.array(z.string()).default([]),
});
export type DocumentationOutput = z.infer<typeof documentationOutputSchema>;

// ---------------------------------------------------------------------------
// Repository analysis
// ---------------------------------------------------------------------------

export const repositoryAnalysisOutputSchema = z.object({
  summary: z.string().min(1),
  primaryLanguage: z.string().nullable().default(null),
  frameworks: z.array(z.string()).default([]),
  packageManager: z.string().nullable().default(null),
  entryPoints: z.array(z.string()).default([]),
  importantModules: z.array(z.string()).default([]),
  testCommands: z.record(z.string()).default({}),
  risks: z.array(z.string()).default([]),
});
export type RepositoryAnalysisOutput = z.infer<typeof repositoryAnalysisOutputSchema>;

// ---------------------------------------------------------------------------
// Provider envelope
// ---------------------------------------------------------------------------

export const agentRunResultSchema = z.object({
  runId: z.string(),
  sessionId: z.string().nullable().default(null),
  status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXCEEDED']),
  /** Role-specific, already validated against the matching output schema. */
  output: z.unknown(),
  rawOutput: z.string().nullable().default(null),
  usage: tokenUsageSchema.default({
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  }),
  estimatedCostUsd: z.number().nonnegative().default(0),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().nonnegative(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retriable: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  messages: z
    .array(
      z.object({
        role: z.enum(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL']),
        content: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;

/** Maps an agent role to the schema its output must satisfy. */
export const ROLE_OUTPUT_SCHEMAS = {
  DOCUMENTATION: documentationOutputSchema,
  PLANNER: plannerOutputSchema,
  ARCHITECT: repositoryAnalysisOutputSchema,
  IMPLEMENTER: implementationOutputSchema,
  BACKEND_DEVELOPER: implementationOutputSchema,
  FRONTEND_DEVELOPER: implementationOutputSchema,
  DATABASE_ENGINEER: implementationOutputSchema,
  DEVOPS_ENGINEER: implementationOutputSchema,
  CODE_REVIEWER: reviewOutputSchema,
  SECURITY_REVIEWER: reviewOutputSchema,
  PERFORMANCE_REVIEWER: reviewOutputSchema,
  UI_REVIEWER: uiReviewOutputSchema,
} as const;
