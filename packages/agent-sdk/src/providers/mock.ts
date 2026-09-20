import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AgentProviderKind, AgentRole } from '@engloop/types';
import {
  documentationInputSchema,
  implementationInputSchema,
  parseSafely,
  plannerInputSchema,
  reviewInputSchema,
  type AgentContinuationContext,
  type AgentRunResult,
  type AgentTaskContext,
  type ImplementationOutput,
  type PlannerOutput,
  type DocumentationOutput,
  type RepositoryAnalysisOutput,
  type ReviewOutput,
  type UiReviewOutput,
} from '@engloop/schemas';
import { estimateCostUsd } from '../cost';
import type { CodingAgentProvider, ProviderCapabilities, ProviderHealth } from '../provider';

export interface MockProviderOptions {
  key?: string;
  name?: string;
  /** Simulated wall-clock latency per run. */
  latencyMs?: number;
  /** 0..1 — probability a run fails, evaluated deterministically from the run id. */
  failureRate?: number;
  /** Reviewer approves once this cycle is reached. Default 2 (fails cycle 1). */
  approveFromCycle?: number;
  model?: string;
}

/** Deterministic 0..1 value derived from a string — keeps mock runs reproducible. */
const hashUnit = (value: string): number => {
  const digest = createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const nowIso = () => new Date().toISOString();

/**
 * MockAgentProvider (spec section 33).
 *
 * Simulates planning, implementation, review, fixing, latency, failures and
 * review findings so the entire engineering loop — and therefore the entire UI —
 * runs locally with no Codex or Claude credentials.
 */
export class MockAgentProvider implements CodingAgentProvider {
  readonly key: string;
  readonly name: string;
  readonly kind = AgentProviderKind.MOCK;
  readonly capabilities: ProviderCapabilities = {
    roles: Object.values(AgentRole),
    resumable: true,
    executesCommands: false,
    commits: false,
    models: ['mock'],
  };

  private readonly cancelled = new Set<string>();

  constructor(private readonly options: MockProviderOptions = {}) {
    this.key = options.key ?? 'mock';
    this.name = options.name ?? 'Mock Agent';
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      healthy: true,
      detail: 'Mock provider is always available; no credentials required.',
      checkedAt: nowIso(),
      latencyMs: 0,
      version: '1.0.0',
    };
  }

  async cancelRun(runId: string): Promise<void> {
    this.cancelled.add(runId);
  }

  async resumeRun(sessionId: string, context: AgentContinuationContext): Promise<AgentRunResult> {
    return this.execute(context, sessionId);
  }

  async startRun(context: AgentTaskContext): Promise<AgentRunResult> {
    return this.execute(context, null);
  }

  private async execute(
    context: AgentTaskContext,
    sessionId: string | null,
  ): Promise<AgentRunResult> {
    const startedAt = new Date();
    const latency = this.options.latencyMs ?? 400;
    await sleep(latency);

    if (this.cancelled.has(context.runId)) {
      this.cancelled.delete(context.runId);
      return this.envelope(context, startedAt, 'CANCELLED', null, {
        code: 'CANCELLED',
        message: 'Run cancelled before completion',
        retriable: false,
      });
    }

    const failureRate = this.options.failureRate ?? 0;
    if (failureRate > 0 && hashUnit(`${context.runId}:failure`) < failureRate) {
      return this.envelope(context, startedAt, 'FAILED', null, {
        code: 'MOCK_SIMULATED_FAILURE',
        message: 'Simulated provider failure (AGENT_MOCK_FAILURE_RATE)',
        retriable: true,
      });
    }

    const output = await this.produceOutput(context);
    return this.envelope(context, startedAt, 'SUCCEEDED', output, null, sessionId);
  }

  private async produceOutput(context: AgentTaskContext): Promise<unknown> {
    switch (context.role) {
      case AgentRole.ARCHITECT:
        return this.analyseRepository(context);
      case AgentRole.PLANNER:
      case AgentRole.PRODUCT:
        return this.plan(context);
      case AgentRole.CODE_REVIEWER:
      case AgentRole.SECURITY_REVIEWER:
      case AgentRole.PERFORMANCE_REVIEWER:
      case AgentRole.QA:
        return this.review(context);
      case AgentRole.UI_REVIEWER:
        return this.reviewUi();
      case AgentRole.DOCUMENTATION:
        return this.document(context);
      default:
        return this.implement(context);
    }
  }

  private analyseRepository(context: AgentTaskContext): RepositoryAnalysisOutput {
    const repo = context.repository;
    return {
      summary: `${repo.name} is a ${repo.primaryLanguage ?? 'TypeScript'} project managed with ${
        repo.packageManager ?? 'pnpm'
      }. Analysis produced by the mock provider.`,
      primaryLanguage: repo.primaryLanguage ?? 'TypeScript',
      frameworks: repo.frameworks.length > 0 ? repo.frameworks : ['Next.js', 'NestJS'],
      packageManager: repo.packageManager ?? 'pnpm',
      entryPoints: ['apps/api/src/main.ts', 'apps/web/app/layout.tsx'],
      importantModules: Object.keys(context.guidance.files).slice(0, 5),
      testCommands: {
        lint: 'pnpm lint',
        typecheck: 'pnpm typecheck',
        unit: 'pnpm test',
        build: 'pnpm build',
      },
      risks: ['Mock analysis — connect a real provider before trusting these findings.'],
    };
  }

  private plan(context: AgentTaskContext): PlannerOutput {
    const parsed = parseSafely(plannerInputSchema, context.input, 'planner input');
    const requirement = parsed.ok ? parsed.data.requirement : 'Unspecified requirement';
    const short = requirement.slice(0, 80);

    return {
      summary: `Deliver "${short}" in three reviewable increments.`,
      approach:
        'Model the data first, expose it through a thin service layer, then wire the UI. Every increment ships with tests so the deterministic checks stay green.',
      risks: [
        'Schema change requires a migration; run it before deploying the API.',
        'The UI increment depends on the API increment landing first.',
      ],
      tasks: [
        {
          title: `Data model and migration for ${short}`,
          objective: 'Add the persistence layer and a reversible migration.',
          description: 'Extend the Prisma schema, generate a migration and cover it with a test.',
          type: 'FEATURE',
          priority: parsed.ok ? parsed.data.priority : 'MEDIUM',
          riskLevel: 'MEDIUM',
          acceptanceCriteria: [
            'Migration applies cleanly on an empty database.',
            'New columns are indexed where they are queried.',
          ],
          implementationNotes: ['Keep the migration additive so it can be rolled back.'],
          suggestedFiles: ['packages/db/prisma/schema.prisma'],
          requiredChecks: ['LINT', 'TYPECHECK', 'UNIT'],
          estimatedTokens: 18_000,
          dependsOn: [],
        },
        {
          title: `Service and API surface for ${short}`,
          objective: 'Expose the capability over REST with validated input.',
          description:
            'Add the module, service and controller. Validation uses the shared Zod schemas.',
          type: 'FEATURE',
          priority: 'HIGH',
          riskLevel: 'MEDIUM',
          acceptanceCriteria: [
            'Endpoint returns the standard success envelope.',
            'Invalid payloads return VALIDATION_FAILED with field details.',
          ],
          implementationNotes: ['No business logic in the controller.'],
          suggestedFiles: ['apps/api/src/modules'],
          requiredChecks: ['LINT', 'TYPECHECK', 'UNIT', 'BUILD'],
          estimatedTokens: 24_000,
          dependsOn: [0],
        },
        {
          title: `UI for ${short}`,
          objective: 'Render the capability with loading, empty and error states.',
          description: 'Add the screen, wire TanStack Query and cover the responsive breakpoints.',
          type: 'UI',
          priority: 'MEDIUM',
          riskLevel: 'LOW',
          acceptanceCriteria: [
            'Screen renders at 1440, 768 and 375 px with no horizontal overflow.',
            'Loading, empty and error states are implemented.',
          ],
          implementationNotes: ['Reuse PageHeader, DataTable and EmptyState.'],
          suggestedFiles: ['apps/web/app'],
          requiredChecks: ['LINT', 'TYPECHECK', 'BUILD'],
          estimatedTokens: 20_000,
          dependsOn: [1],
        },
      ],
      acceptanceCriteria: [
        'All three increments merged behind passing checks.',
        'No critical or high review findings remain open.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT', 'BUILD'],
      dependencies: [],
      architectureNotes: [
        'Business logic stays in services; controllers only translate HTTP.',
        'Shared Zod schemas are the single validation source for web and API.',
      ],
      openQuestions: [],
    };
  }

  /**
   * Writes the mock's one real artefact inside the worktree.
   *
   * The mock cannot write production code, but it must leave a genuine change on
   * disk: otherwise the commit is empty, the reviewer sees an empty diff and the
   * offline loop can never demonstrate implement → verify → review → PR. The note
   * is Markdown under a dot-directory so it cannot break a repository's lint,
   * typecheck or build.
   */
  private async writeImplementationNote(
    context: AgentTaskContext,
    body: string,
  ): Promise<string | null> {
    const workspace = context.workspacePath;
    if (!workspace || !isAbsolute(workspace)) return null;

    const taskKey = String(
      (context.input as { taskKey?: unknown } | null)?.taskKey ??
        context.correlation.taskId ??
        'task',
    ).replace(/[^A-Za-z0-9._-]/g, '_');

    const target = resolve(join(workspace, '.engloop', `${taskKey}.md`));
    const inside = relative(workspace, target);
    // Defence in depth: a crafted task key must never escape the worktree.
    if (inside.startsWith('..') || isAbsolute(inside)) return null;

    await mkdir(resolve(join(workspace, '.engloop')), { recursive: true });
    await writeFile(target, body, 'utf8');
    return inside;
  }

  private async implement(context: AgentTaskContext): Promise<ImplementationOutput> {
    const parsed = parseSafely(implementationInputSchema, context.input, 'implementation input');
    const input = parsed.ok ? parsed.data : null;
    const isFix = (input?.fixFindings.length ?? 0) > 0 || (input?.failedChecks.length ?? 0) > 0;
    const taskId = input?.taskId ?? context.correlation.taskId ?? 'unknown';

    const files = (
      input?.suggestedFiles.length
        ? input.suggestedFiles
        : ['src/index.ts', 'src/service.ts', 'src/service.spec.ts']
    ).slice(0, 6);

    const notePath = await this.writeImplementationNote(
      context,
      [
        `# ${input?.taskKey ?? taskId} — ${input?.title ?? 'task'}`,
        '',
        `Attempt: ${String(input?.attempt ?? 1)}`,
        `Mode: ${isFix ? 'fix' : 'implementation'}`,
        '',
        '## Objective',
        input?.objective ?? '(not provided)',
        '',
        '## Acceptance criteria',
        ...(input?.acceptanceCriteria.length
          ? input.acceptanceCriteria.map((criterion) => `- ${criterion}`)
          : ['- (none recorded)']),
        '',
        '## Findings addressed',
        ...(input?.fixFindings.length
          ? input.fixFindings.map((finding) => `- [${finding.severity}] ${finding.problem}`)
          : ['- (none)']),
        '',
        '## Failing checks addressed',
        ...(input?.failedChecks.length
          ? input.failedChecks.map(
              (check) => `- ${check.checkType} (exit ${String(check.exitCode)})`,
            )
          : ['- (none)']),
        '',
        '> Written by the mock provider. It documents the work rather than',
        '> performing it, so the loop can be exercised without a real coding agent.',
        '',
      ].join('\n'),
    );

    return {
      taskId,
      status: 'implementation_complete',
      summary: isFix
        ? `Resolved ${String(input?.fixFindings.length ?? 0)} review finding(s) and ${String(
            input?.failedChecks.length ?? 0,
          )} failing check(s).`
        : `Implemented "${input?.title ?? 'the task'}" with accompanying unit tests.`,
      changedFiles: [
        ...(notePath
          ? [
              {
                path: notePath,
                changeType: (isFix ? 'modified' : 'added') as 'added' | 'modified',
                additions: 1,
                deletions: 0,
              },
            ]
          : []),
        ...files.map((path, index) => ({
          path,
          changeType:
            index === files.length - 1 && !isFix ? ('added' as const) : ('modified' as const),
          additions: 24 + index * 11,
          deletions: index * 4,
        })),
      ],
      testsAdded: isFix ? [] : [`${files[0] ?? 'src/index'}.spec.ts`],
      commandsRun: [
        { command: 'pnpm lint', exitCode: 0, durationMs: 3_400 },
        { command: 'pnpm typecheck', exitCode: 0, durationMs: 5_100 },
        { command: 'pnpm test', exitCode: 0, durationMs: 9_800 },
      ],
      commit: null,
      warnings: notePath
        ? [`Mock implementation — wrote ${notePath}; no production source files were modified.`]
        : ['Mock implementation — no worktree was available to write to.'],
      blockedReason: null,
    };
  }

  private review(context: AgentTaskContext): ReviewOutput {
    const parsed = parseSafely(reviewInputSchema, context.input, 'review input');
    const cycle = parsed.ok ? parsed.data.cycle : 1;
    const approveFrom = this.options.approveFromCycle ?? 2;

    if (cycle >= approveFrom) {
      return {
        decision: 'approved',
        score: 92,
        summary:
          'All acceptance criteria are met, deterministic checks pass and the previous findings are resolved.',
        findings: [],
        coverageAssessment: 'Coverage on changed lines is adequate for the risk level.',
        architectureAssessment: 'Layering is respected; no business logic leaked into controllers.',
        securityAssessment: 'No injection, authz or secret-handling issues found in the diff.',
        performanceAssessment: 'No N+1 access patterns or unbounded loops introduced.',
      };
    }

    return {
      decision: 'changes_requested',
      score: 61,
      summary:
        'Implementation matches the plan, but one blocking issue and one maintainability issue must be resolved before approval.',
      findings: [
        {
          severity: 'HIGH',
          category: 'CORRECTNESS',
          file: parsed.ok
            ? (parsed.data.changedFiles[0]?.path ?? 'src/service.ts')
            : 'src/service.ts',
          line: 42,
          problem:
            'The new code path does not handle the empty-result case and will dereference undefined at runtime.',
          requiredFix: 'Return an explicit empty result and add a regression test for it.',
          evidence: null,
        },
        {
          severity: 'MEDIUM',
          category: 'TESTING',
          file: null,
          line: null,
          problem: 'The failure branch introduced in this change is not covered by any test.',
          requiredFix: 'Add a unit test that asserts the error envelope for the failure branch.',
          evidence: null,
        },
      ],
      coverageAssessment: 'The happy path is covered; the failure branch is not.',
      architectureAssessment: 'Module boundaries look correct.',
      securityAssessment: 'No security issues identified in this diff.',
      performanceAssessment: 'No performance concerns identified.',
    };
  }

  private reviewUi(): UiReviewOutput {
    return {
      decision: 'changes_requested',
      summary: 'Layout holds at desktop and tablet; one overflow issue at 375px.',
      findings: [
        {
          severity: 'MEDIUM',
          category: 'OVERFLOW',
          viewport: 'MOBILE',
          page: '/tasks',
          problem: 'The task table forces horizontal scrolling at 375px.',
          requiredFix: 'Collapse the table into stacked cards below the md breakpoint.',
          screenshotId: null,
        },
      ],
    };
  }

  private document(context: AgentTaskContext): DocumentationOutput {
    const parsed = parseSafely(documentationInputSchema, context.input, 'documentation input');
    const requirement = parsed.ok ? parsed.data.requirement : 'Unspecified requirement';
    const short = requirement.slice(0, 80);

    return {
      summary: `Documented "${short}" (mock provider).`,
      documents: [
        {
          path: 'docs/change-notes.md',
          title: short,
          content: `# ${short}

${parsed.ok ? (parsed.data.implementationSummary ?? requirement) : requirement}
`,
        },
      ],
      gaps: [],
    };
  }

  private envelope(
    context: AgentTaskContext,
    startedAt: Date,
    status: AgentRunResult['status'],
    output: unknown,
    error: AgentRunResult['error'] = null,
    sessionId: string | null = null,
  ): AgentRunResult {
    const completedAt = new Date();
    const seed = hashUnit(`${context.runId}:usage`);
    const inputTokens = Math.round(4_000 + seed * 12_000);
    const outputTokens = Math.round(900 + seed * 4_500);
    const cachedTokens = Math.round(inputTokens * 0.25);
    const usage = {
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
    };
    const model = this.options.model ?? 'mock';

    return {
      runId: context.runId,
      sessionId: sessionId ?? `mock-session-${context.runId.slice(0, 8)}`,
      status,
      output,
      rawOutput: output === null ? null : JSON.stringify(output, null, 2),
      usage,
      estimatedCostUsd: estimateCostUsd(usage, model),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error,
      messages: [
        {
          role: 'SYSTEM',
          content: `Mock ${context.role} run for ${context.repository.name}`,
          createdAt: startedAt.toISOString(),
        },
        {
          role: 'ASSISTANT',
          content:
            output === null
              ? (error?.message ?? 'no output')
              : `Produced structured ${context.role} output (${String(
                  JSON.stringify(output).length,
                )} bytes).`,
          createdAt: completedAt.toISOString(),
        },
      ],
    };
  }
}
