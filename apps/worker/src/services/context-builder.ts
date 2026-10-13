import { AGENT_CONTEXT_FILES, MAX_CONTEXT_FILE_BYTES, type Env } from '@engloop/config';
import { collectRepositoryContext } from '@engloop/git';
import type { AgentRole } from '@engloop/types';
import { decimalToNumber, type PrismaClient } from '@engloop/db';
import type { AgentTaskContext } from '@engloop/schemas';
import type { WorkflowExecutionSnapshot, ExecutionRoleSnapshot } from '@engloop/schemas';
import { narrowPermission } from './execution-snapshot';

export interface BuildContextInput {
  runId: string;
  role: AgentRole;
  taskId: string;
  workspacePath: string;
  branchName?: string | null;
  input: unknown;
  traceId: string;
  workflowRunId?: string;
  budgetOverrides?: Partial<AgentTaskContext['budget']>;
  snapshot?: WorkflowExecutionSnapshot;
  roleSnapshot?: ExecutionRoleSnapshot;
}

/**
 * Assembles everything an agent is allowed to see (spec sections 10 and 17):
 * project metadata, repository facts, versioned project memory and the
 * repository's own AGENTS.md / CLAUDE.md / .ai/* guidance.
 */
export class ContextBuilder {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
  ) {}

  async build(input: BuildContextInput): Promise<AgentTaskContext> {
    if (input.snapshot && input.roleSnapshot)
      return this.buildSnapshotContext(input, input.snapshot, input.roleSnapshot);
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: input.taskId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            permissionLevel: true,
            organizationId: true,
            memories: { where: { active: true } },
          },
        },
        repository: true,
      },
    });

    const memoryByKind = new Map(task.project.memories.map((row) => [row.kind, row.content]));
    const asList = (value: string | undefined): string[] =>
      value
        ? value
            .split('\n')
            .map((line) => line.replace(/^[-*]\s*/, '').trim())
            .filter(Boolean)
        : [];

    const guidance = await collectRepositoryContext({
      rootPath: input.workspacePath,
      files: AGENT_CONTEXT_FILES,
      maxBytesPerFile: MAX_CONTEXT_FILE_BYTES,
    });

    const commands = (task.repository?.commands ?? {}) as Record<string, string>;

    return {
      runId: input.runId,
      role: input.role,
      project: {
        id: task.project.id,
        name: task.project.name,
        slug: task.project.slug,
        description: task.project.description,
        permissionLevel: task.project.permissionLevel,
      },
      repository: {
        id: task.repository?.id ?? 'none',
        name: task.repository?.name ?? task.project.name,
        provider: task.repository?.provider ?? 'LOCAL',
        defaultBranch: task.repository?.defaultBranch ?? this.env.GIT_DEFAULT_BASE_BRANCH,
        primaryLanguage: task.repository?.primaryLanguage ?? null,
        frameworks: task.repository?.frameworks ?? [],
        packageManager: task.repository?.packageManager ?? 'pnpm',
        rootPath: input.workspacePath,
        fileCount: null,
      },
      memory: {
        architecture: memoryByKind.get('ARCHITECTURE') ?? null,
        techStack: asList(memoryByKind.get('TECH_STACK')),
        conventions: asList(memoryByKind.get('CONVENTIONS')),
        apiConventions: asList(memoryByKind.get('API_CONVENTIONS')),
        uiConventions: asList(memoryByKind.get('UI_CONVENTIONS')),
        testCommands: commands,
        knownTechDebt: asList(memoryByKind.get('TECH_DEBT')),
        knownBugs: asList(memoryByKind.get('KNOWN_BUGS')),
        completedFeatures: asList(memoryByKind.get('COMPLETED_FEATURES')),
        importantModules: asList(memoryByKind.get('IMPORTANT_MODULES')),
        decisions: asList(memoryByKind.get('DECISIONS')),
      },
      guidance: { files: guidance.files, truncated: guidance.truncated },
      budget: {
        timeoutMs: this.env.AGENT_RUN_TIMEOUT_MS,
        maxTokens: this.env.AGENT_TOKEN_BUDGET,
        maxCostUsd: this.env.AGENT_COST_BUDGET_USD,
        allowedCommands: [...this.env.COMMAND_ALLOWLIST],
        ...input.budgetOverrides,
      },
      workspacePath: input.workspacePath,
      branchName: input.branchName ?? null,
      input: input.input,
      correlation: {
        traceId: input.traceId,
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId: task.id,
        ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      },
    };
  }

  private async buildSnapshotContext(
    input: BuildContextInput,
    snapshot: WorkflowExecutionSnapshot,
    role: ExecutionRoleSnapshot,
  ): Promise<AgentTaskContext> {
    const guidance = await collectRepositoryContext({
      rootPath: input.workspacePath,
      files: AGENT_CONTEXT_FILES,
      maxBytesPerFile: MAX_CONTEXT_FILE_BYTES,
    });
    const memories = new Map(snapshot.memories.map((row) => [row.kind, row.content]));
    const list = (kind: string): string[] =>
      (memories.get(kind as (typeof snapshot.memories)[number]['kind']) ?? '')
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    const repository = snapshot.repository;
    return {
      runId: input.runId,
      role: input.role,
      project: {
        id: snapshot.projectId,
        name: snapshot.project.name,
        slug: snapshot.project.slug,
        description: snapshot.project.description,
        permissionLevel: narrowPermission(snapshot.project.permissionLevel, role.permissionLevel),
      },
      repository: {
        id: repository?.id ?? 'none',
        name: repository?.name ?? snapshot.project.name,
        provider: repository?.provider ?? 'LOCAL',
        defaultBranch: repository?.defaultBranch ?? this.env.GIT_DEFAULT_BASE_BRANCH,
        primaryLanguage: repository?.primaryLanguage ?? null,
        frameworks: repository?.frameworks ?? [],
        packageManager: repository?.packageManager ?? 'pnpm',
        rootPath: input.workspacePath,
        fileCount: null,
      },
      memory: {
        architecture: memories.get('ARCHITECTURE') ?? null,
        techStack: list('TECH_STACK'),
        conventions: list('CONVENTIONS'),
        apiConventions: list('API_CONVENTIONS'),
        uiConventions: list('UI_CONVENTIONS'),
        testCommands: repository?.commands ?? {},
        knownTechDebt: list('TECH_DEBT'),
        knownBugs: list('KNOWN_BUGS'),
        completedFeatures: list('COMPLETED_FEATURES'),
        importantModules: list('IMPORTANT_MODULES'),
        decisions: list('DECISIONS'),
      },
      guidance: { files: guidance.files, truncated: guidance.truncated },
      budget: {
        timeoutMs: Math.min(role.budget.timeoutMs, this.env.AGENT_RUN_TIMEOUT_MS),
        maxTokens: Math.min(role.budget.maxTokens, this.env.AGENT_TOKEN_BUDGET),
        maxCostUsd: Math.min(role.budget.maxCostUsd, this.env.AGENT_COST_BUDGET_USD),
        allowedCommands: role.budget.allowedCommands.filter((command) =>
          this.env.COMMAND_ALLOWLIST.includes(command),
        ),
        ...input.budgetOverrides,
      },
      execution: {
        model: role.model,
        systemPrompt: role.systemPrompt,
        outputContractVersion: 1,
        ...(role.prompt
          ? {
              prompt: {
                templateId: role.prompt.templateId,
                revision: role.prompt.revision,
                body: role.prompt.rendered,
              },
            }
          : {}),
      },
      workspacePath: input.workspacePath,
      branchName: input.branchName ?? null,
      input: input.input,
      correlation: {
        traceId: input.traceId,
        organizationId: snapshot.organizationId,
        projectId: snapshot.projectId,
        taskId: snapshot.taskId,
        ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      },
    };
  }

  /** Resolves which registered provider serves a role for this project. */
  async resolveRoleProvider(
    projectId: string,
    role: AgentRole,
  ): Promise<{
    providerKey: string;
    agentId: string | null;
    model: string | null;
    agentTimeoutMs?: number;
    agentMaxTokens?: number;
    agentMaxCostUsd?: number;
  }> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        roleAssignments: true,
        teamConfigured: true,
        organizationId: true,
        organization: { select: { defaultProviderKey: true } },
      },
    });

    const assignments = (project.roleAssignments ?? {}) as Record<string, string>;
    const assignedId = assignments[role];
    const membership = project.teamConfigured ? { teamMemberships: { some: { projectId } } } : {};

    const agent =
      (assignedId
        ? await this.prisma.agent.findFirst({
            where: {
              id: assignedId,
              ...membership,
              organizationId: project.organizationId,
              role,
              enabled: true,
              OR: [{ projectId: null }, { projectId }],
              provider: { organizationId: project.organizationId, enabled: true },
            },
            include: { provider: true },
          })
        : null) ??
      (await this.prisma.agent.findFirst({
        where: {
          organizationId: project.organizationId,
          ...membership,
          role,
          enabled: true,
          projectId,
          provider: { organizationId: project.organizationId, enabled: true },
        },
        include: { provider: true },
        ...(project.teamConfigured ? { orderBy: { id: 'asc' as const } } : {}),
      })) ??
      (await this.prisma.agent.findFirst({
        where: {
          organizationId: project.organizationId,
          ...membership,
          role,
          enabled: true,
          projectId: null,
          provider: { organizationId: project.organizationId, enabled: true },
        },
        include: { provider: true },
        ...(project.teamConfigured ? { orderBy: { id: 'asc' as const } } : {}),
      }));

    if (agent?.provider.enabled) {
      return {
        providerKey: agent.provider.key,
        agentId: agent.id,
        model: agent.model ?? agent.provider.defaultModel,
        // The agent row's own limits win over the process-wide defaults.
        agentTimeoutMs: agent.timeoutMs,
        agentMaxTokens: agent.maxTokens,
        agentMaxCostUsd: decimalToNumber(agent.maxCostUsd),
      };
    }

    if (project.teamConfigured) {
      throw new Error(`PROJECT_TEAM_ROLE_UNCOVERED: No eligible project team member for ${role}`);
    }

    return {
      providerKey: project.organization.defaultProviderKey || this.env.AGENT_DEFAULT_PROVIDER,
      agentId: null,
      model: null,
    };
  }
}
