import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getEnv, type Env } from '@engloop/config';
import type { Prisma } from '@engloop/db';
import {
  AgentRole,
  ApiErrorCode,
  PERMISSION_LEVEL_ORDER,
  ProjectPhaseStatus,
} from '@engloop/types';
import {
  plannerPhaseContextSchema,
  executionSelectionSchema,
  renderPrompt,
  workflowExecutionSnapshotSchema,
  type ExecutionSelection,
  type ExecutionRoleSnapshot,
  type WorkflowExecutionSnapshot,
} from '@engloop/schemas';
import { AppError } from '../../common/errors/app-error';

const providerSelect = {
  id: true,
  key: true,
  kind: true,
  defaultModel: true,
  updatedAt: true,
} satisfies Prisma.AgentProviderSelect;
const agentSelect = {
  id: true,
  model: true,
  systemPrompt: true,
  timeoutMs: true,
  maxTokens: true,
  maxCostUsd: true,
  permissionLevel: true,
  allowedCommands: true,
  updatedAt: true,
  configurations: {
    where: { active: true },
    select: { id: true, version: true },
    orderBy: { version: 'asc' as const },
  },
  provider: { select: providerSelect },
} satisfies Prisma.AgentSelect;
const settingsSchema = z.record(z.unknown());

/** Capture domain inputs in the transaction that creates the run; no secret-bearing values are read. */
export class ExecutionSnapshotsService {
  constructor(private readonly configuredEnv?: Env) {}

  async capture(
    tx: Prisma.TransactionClient,
    organizationId: string,
    taskId: string,
    selection: ExecutionSelection,
    options: { planOnly: boolean; skipPlanning: boolean },
  ): Promise<WorkflowExecutionSnapshot> {
    const parsedSelection = executionSelectionSchema.safeParse(selection);
    if (!parsedSelection.success) throw AppError.validation(parsedSelection.error.message);
    selection = parsedSelection.data;
    const env = this.configuredEnv ?? getEnv();
    const task = await tx.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: {
        id: true,
        projectId: true,
        key: true,
        title: true,
        description: true,
        objective: true,
        type: true,
        priority: true,
        riskLevel: true,
        acceptanceCriteria: true,
        implementationNotes: true,
        suggestedFiles: true,
        requiredChecks: true,
        phaseId: true,
        ownerRole: true,
        maxAttempts: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            permissionLevel: true,
            maxReviewCycles: true,
            costBudgetUsd: true,
            teamVersion: true,
            teamConfigured: true,
            roleAssignments: true,
            settings: true,
            contractObjective: true,
            contractRequirements: true,
            contractNonGoals: true,
            contractAcceptanceCriteria: true,
            organization: { select: { defaultProviderKey: true } },
          },
        },
        repository: {
          select: {
            id: true,
            provider: true,
            name: true,
            defaultBranch: true,
            primaryLanguage: true,
            frameworks: true,
            packageManager: true,
            commands: true,
          },
        },
      },
    });
    if (!task) throw AppError.notFound('Task', taskId);
    const project = task.project;
    const settings = settingsSchema.safeParse(project.settings);
    const uiQa = z
      .object({ enabled: z.unknown().optional() })
      .safeParse(settings.success ? settings.data.uiQa : undefined);
    const documentation = z
      .object({ enabled: z.unknown().optional() })
      .safeParse(settings.success ? settings.data.documentation : undefined);
    const uiQaEnabled = uiQa.success && uiQa.data.enabled === true;
    const documentationEnabled = !documentation.success || documentation.data.enabled !== false;
    let phaseContext: WorkflowExecutionSnapshot['phaseContext'];
    if (task.phaseId) {
      const phase = await tx.projectPhase.findFirst({
        where: { id: task.phaseId, projectId: project.id },
      });
      if (!phase || phase.status !== ProjectPhaseStatus.ACTIVE)
        throw AppError.conflict(
          ApiErrorCode.VALIDATION_FAILED,
          'Execution requires an ACTIVE phase in the task project',
        );
      phaseContext = plannerPhaseContextSchema.parse({
        phaseId: phase.id,
        phaseUpdatedAt: phase.updatedAt.toISOString(),
        projectRequirements: project.contractRequirements,
        projectObjective: project.contractObjective,
        projectNonGoals: project.contractNonGoals,
        projectAcceptanceCriteria: project.contractAcceptanceCriteria,
        name: phase.name,
        objective: phase.objective,
        deliverables: phase.deliverables,
        acceptanceCriteria: phase.acceptanceCriteria,
        requiredRoles: phase.requiredRoles,
      });
    }
    const roles: AgentRole[] = options.skipPlanning ? [] : [AgentRole.ARCHITECT, AgentRole.PLANNER];
    if (!options.planOnly) {
      roles.push(AgentRole.IMPLEMENTER, AgentRole.CODE_REVIEWER);
      if (documentationEnabled) roles.push(AgentRole.DOCUMENTATION);
      if (uiQaEnabled) roles.push(AgentRole.UI_REVIEWER);
    }
    if (selection.prompts.some((prompt) => !roles.includes(prompt.role)))
      throw AppError.validation('A selected prompt role is not executed by this workflow');
    const assignments = z.record(z.string()).safeParse(project.roleAssignments);
    const roleSnapshots: ExecutionRoleSnapshot[] = [];
    for (const role of roles) {
      const assignedId = assignments.success ? assignments.data[role] : undefined;
      const common = {
        organizationId,
        role,
        enabled: true,
        provider: { organizationId, enabled: true },
        ...(project.teamConfigured ? { teamMemberships: { some: { projectId: project.id } } } : {}),
      };
      const agent =
        (assignedId
          ? await tx.agent.findFirst({
              where: {
                ...common,
                id: assignedId,
                OR: [{ projectId: null }, { projectId: project.id }],
              },
              select: agentSelect,
            })
          : null) ??
        (await tx.agent.findFirst({
          where: { ...common, projectId: project.id },
          select: agentSelect,
          orderBy: { id: 'asc' },
        })) ??
        (await tx.agent.findFirst({
          where: { ...common, projectId: null },
          select: agentSelect,
          orderBy: { id: 'asc' },
        }));
      if (!agent && project.teamConfigured)
        throw AppError.conflict(
          ApiErrorCode.PROJECT_TEAM_ROLE_UNCOVERED,
          `No eligible project team member for ${role}`,
        );
      const provider =
        agent?.provider ??
        (await tx.agentProvider.findFirst({
          where: {
            organizationId,
            enabled: true,
            key: project.organization.defaultProviderKey || env.AGENT_DEFAULT_PROVIDER,
          },
          select: providerSelect,
        }));
      if (!provider) throw AppError.validation(`No enabled provider available for ${role}`);
      const model =
        agent?.model ??
        provider.defaultModel ??
        (provider.kind === 'CODEX'
          ? env.CODEX_MODEL
          : provider.kind === 'CLAUDE_CODE'
            ? env.CLAUDE_CODE_MODEL
            : null);
      const agentLevel = agent?.permissionLevel ?? project.permissionLevel;
      const permissionLevel =
        PERMISSION_LEVEL_ORDER[
          Math.min(
            PERMISSION_LEVEL_ORDER.indexOf(agentLevel),
            PERMISSION_LEVEL_ORDER.indexOf(project.permissionLevel),
          )
        ]!;
      const promptSelection = selection.prompts.find((prompt) => prompt.role === role);
      let prompt: ExecutionRoleSnapshot['prompt'];
      if (promptSelection) {
        const revision = await tx.promptRevision.findFirst({
          where: {
            templateId: promptSelection.templateId,
            revision: promptSelection.revision,
            template: { projectId: project.id, role, project: { organizationId } },
          },
          select: { body: true },
        });
        if (!revision)
          throw AppError.notFound(
            'PromptRevision',
            `${promptSelection.templateId}/${promptSelection.revision}`,
          );
        try {
          prompt = {
            templateId: promptSelection.templateId,
            revision: promptSelection.revision,
            body: revision.body,
            rendered: renderPrompt(revision.body, {
              'task.title': task.title,
              'task.description': task.description,
              'task.objective': task.objective,
              'task.acceptanceCriteria': JSON.stringify(task.acceptanceCriteria),
              'project.name': project.name,
              'project.objective': project.contractObjective ?? '',
              role,
              ...(phaseContext ? { 'phase.objective': phaseContext.objective ?? '' } : {}),
            }),
          };
        } catch (error) {
          throw AppError.validation(
            error instanceof Error ? error.message : 'Prompt rendering failed',
          );
        }
      }
      roleSnapshots.push({
        role,
        agentId: agent?.id ?? null,
        providerId: provider.id,
        providerKey: provider.key,
        providerKind: provider.kind,
        model,
        ...(agent ? { agentUpdatedAt: agent.updatedAt.toISOString() } : {}),
        providerUpdatedAt: provider.updatedAt.toISOString(),
        configurationVersions: agent?.configurations ?? [],
        systemPrompt: agent?.systemPrompt ?? null,
        permissionLevel,
        budget: {
          timeoutMs: Math.min(
            agent?.timeoutMs ?? env.AGENT_RUN_TIMEOUT_MS,
            env.AGENT_RUN_TIMEOUT_MS,
          ),
          maxTokens: Math.min(agent?.maxTokens ?? env.AGENT_TOKEN_BUDGET, env.AGENT_TOKEN_BUDGET),
          maxCostUsd: Math.min(
            Number(agent?.maxCostUsd ?? env.AGENT_COST_BUDGET_USD),
            env.AGENT_COST_BUDGET_USD,
            Number(project.costBudgetUsd) > 0 ? Number(project.costBudgetUsd) : Infinity,
          ),
          // Existing empty agent allowlists inherit process policy; explicit lists can only narrow it.
          allowedCommands: agent?.allowedCommands.length
            ? env.COMMAND_ALLOWLIST.filter((command) => agent.allowedCommands.includes(command))
            : [...env.COMMAND_ALLOWLIST],
        },
        ...(prompt ? { prompt } : {}),
      });
    }
    const memories = await tx.projectMemory.findMany({
      where: { projectId: project.id, active: true },
      select: { id: true, kind: true, version: true, content: true },
      orderBy: [{ kind: 'asc' }, { version: 'asc' }],
    });
    const artifacts = await tx.artifact.findMany({
      where: { taskId },
      select: { id: true, kind: true, createdAt: true, content: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const { project: _project, repository, projectId: _projectId, ...taskSpec } = task;
    return workflowExecutionSnapshotSchema.parse({
      version: 1,
      organizationId,
      projectId: project.id,
      taskId,
      capturedAt: new Date().toISOString(),
      task: { ...taskSpec, updatedAt: task.updatedAt.toISOString() },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        permissionLevel: project.permissionLevel,
        maxReviewCycles: project.maxReviewCycles,
        costBudgetUsd: Number(project.costBudgetUsd),
        teamVersion: project.teamVersion,
        uiQaEnabled,
        documentationEnabled,
      },
      repository: repository
        ? { ...repository, commands: z.record(z.string()).parse(repository.commands) }
        : null,
      memories,
      ...(phaseContext ? { phaseContext } : {}),
      roles: roleSnapshots,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        createdAt: artifact.createdAt.toISOString(),
        contentHash:
          artifact.content === null
            ? null
            : createHash('sha256').update(artifact.content).digest('hex'),
      })),
    });
  }
}
