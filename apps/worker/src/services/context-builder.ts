import { AGENT_CONTEXT_FILES, MAX_CONTEXT_FILE_BYTES, type Env } from '@engloop/config';
import { collectRepositoryContext } from '@engloop/git';
import type { AgentRole } from '@engloop/types';
import { decimalToNumber, type PrismaClient } from '@engloop/db';
import type { AgentTaskContext } from '@engloop/schemas';

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
        organizationId: true,
        organization: { select: { defaultProviderKey: true } },
      },
    });

    const assignments = (project.roleAssignments ?? {}) as Record<string, string>;
    const assignedId = assignments[role];

    const agent =
      (assignedId
        ? await this.prisma.agent.findFirst({
            where: {
              id: assignedId,
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
          role,
          enabled: true,
          projectId,
          provider: { organizationId: project.organizationId, enabled: true },
        },
        include: { provider: true },
      })) ??
      (await this.prisma.agent.findFirst({
        where: {
          organizationId: project.organizationId,
          role,
          enabled: true,
          projectId: null,
          provider: { organizationId: project.organizationId, enabled: true },
        },
        include: { provider: true },
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

    return {
      providerKey: project.organization.defaultProviderKey || this.env.AGENT_DEFAULT_PROVIDER,
      agentId: null,
      model: null,
    };
  }
}
