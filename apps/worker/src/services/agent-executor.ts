import { AgentRunStatus, AuditAction, RunStatus, TaskStatus, type AgentRole } from '@engloop/types';
import type { Env } from '@engloop/config';
import type { EngLoopLogger } from '@engloop/logger';
import type { Prisma, PrismaClient } from '@engloop/db';
import {
  type AgentProviderRegistry,
  AgentOutputInvalidError,
  ProviderUnavailableError,
} from '@engloop/agent-sdk';
import { ROLE_OUTPUT_SCHEMAS, parseSafely, type AgentRunResult } from '@engloop/schemas';
import type { AuditWriter } from './audit-writer';
import type { UsageRecorder } from './usage-recorder';
import type { ContextBuilder } from './context-builder';
import type { CredentialResolver } from './credential-resolver';
import type { ProviderCredentialStore } from './provider-credential-store';
import { claudeCodeCliAuth, codexCliAuth, type CliAuth } from '../provider-auth';

export interface ExecuteAgentInput {
  taskId: string;
  role: AgentRole;
  input: unknown;
  workspacePath: string;
  branchName?: string | null;
  traceId: string;
  workflowRunId?: string;
  workflowStepId?: string;
  attempt?: number;
}

export interface ExecuteAgentOutcome {
  agentRunId: string;
  status: AgentRunStatus;
  output: unknown;
  error: string | null;
  costUsd: number;
  budgetExceeded: boolean;
}

interface AgentExecutorDeps {
  prisma: PrismaClient;
  registry: AgentProviderRegistry;
  logger: EngLoopLogger;
  env: Env;
  audit: AuditWriter;
  usage: UsageRecorder;
  contextBuilder: ContextBuilder;
  credentials: CredentialResolver;
  credentialStore: ProviderCredentialStore;
}

/**
 * Runs one agent and persists everything about it (spec sections 8, 21, 31).
 *
 * Enforces the run-level safety envelope: isolated workspace, timeout, token and
 * cost budget, schema-validated output, full audit trail.
 */
export class AgentExecutor {
  constructor(private readonly deps: AgentExecutorDeps) {}

  async execute(input: ExecuteAgentInput): Promise<ExecuteAgentOutcome> {
    const { prisma, registry, logger, audit, usage, contextBuilder, credentialStore } = this.deps;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: {
        id: true,
        key: true,
        projectId: true,
        project: { select: { organizationId: true } },
      },
    });

    await this.assertWorkflowOwnership(input, task.projectId);

    const resolution = await contextBuilder.resolveRoleProvider(task.projectId, input.role);
    const providerRow = await prisma.agentProvider.findFirst({
      where: {
        organizationId: task.project.organizationId,
        key: resolution.providerKey,
        enabled: true,
      },
      select: { id: true },
    });

    if (!providerRow) {
      throw new ProviderUnavailableError(
        resolution.providerKey,
        'provider is missing or disabled for this organization',
      );
    }

    if (resolution.agentId) {
      const resolvedAgent = await prisma.agent.findFirst({
        where: {
          id: resolution.agentId,
          organizationId: task.project.organizationId,
          enabled: true,
          role: input.role,
          providerId: providerRow.id,
          OR: [{ projectId: null }, { projectId: task.projectId }],
        },
        select: { id: true },
      });
      if (!resolvedAgent) {
        throw new ProviderUnavailableError(
          resolution.providerKey,
          'resolved agent is not enabled for this organization, project, role, and provider',
        );
      }
    }

    const budget = await usage.budgetExceeded(input.taskId);
    if (budget.exceeded) {
      logger.warn({ taskId: input.taskId, ...budget }, 'agent.budget_exceeded');
      const run = await prisma.$transaction(async (tx) => {
        const lockedTask = await tx.$queryRaw<Array<{ status: TaskStatus }>>`
          SELECT status FROM tasks WHERE id = ${input.taskId} FOR UPDATE
        `;
        const workflowState = input.workflowRunId
          ? await tx.workflowRun.findUnique({
              where: { id: input.workflowRunId },
              select: { status: true },
            })
          : null;
        const parentCancelled =
          lockedTask[0]?.status === TaskStatus.CANCELLED ||
          workflowState?.status === RunStatus.CANCELLED;
        return tx.agentRun.create({
          data: {
            taskId: input.taskId,
            workflowRunId: input.workflowRunId ?? null,
            workflowStepId: input.workflowStepId ?? null,
            agentId: resolution.agentId,
            providerId: providerRow.id,
            role: input.role,
            providerKey: resolution.providerKey,
            model: resolution.model,
            status: parentCancelled
              ? AgentRunStatus.CANCELLED
              : AgentRunStatus.BUDGET_EXCEEDED,
            errorCode: parentCancelled ? null : 'AGENT_BUDGET_EXCEEDED',
            errorMessage: parentCancelled
              ? 'Parent task or workflow was cancelled'
              : `Spent $${budget.spent.toFixed(4)} of $${budget.limit.toFixed(2)}`,
            traceId: input.traceId,
            completedAt: new Date(),
          },
        });
      });
      return {
        agentRunId: run.id,
        status: run.status,
        output: null,
        error: run.errorMessage,
        costUsd: 0,
        budgetExceeded: run.status === AgentRunStatus.BUDGET_EXCEEDED,
      };
    }

    // Creating an execution shares the task row lock with cancellation. If the
    // parent cancellation won, record a terminal child without ever starting or
    // auditing provider work. If creation won, cancellation sees and claims it.
    const agentRun = await prisma.$transaction(async (tx) => {
      const lockedTask = await tx.$queryRaw<Array<{ status: TaskStatus }>>`
        SELECT status FROM tasks WHERE id = ${input.taskId} FOR UPDATE
      `;
      const workflowState = input.workflowRunId
        ? await tx.workflowRun.findUnique({
            where: { id: input.workflowRunId },
            select: { status: true },
          })
        : null;
      const parentCancelled =
        lockedTask[0]?.status === TaskStatus.CANCELLED ||
        workflowState?.status === RunStatus.CANCELLED;
      return tx.agentRun.create({
        data: {
          taskId: input.taskId,
          workflowRunId: input.workflowRunId ?? null,
          workflowStepId: input.workflowStepId ?? null,
          agentId: resolution.agentId,
          providerId: providerRow.id,
          role: input.role,
          providerKey: resolution.providerKey,
          model: resolution.model,
          status: parentCancelled ? AgentRunStatus.CANCELLED : AgentRunStatus.RUNNING,
          input: (input.input ?? {}) as Prisma.InputJsonValue,
          attempt: input.attempt ?? 1,
          workspacePath: input.workspacePath,
          traceId: input.traceId,
          ...(parentCancelled
            ? {
                completedAt: new Date(),
                errorMessage: 'Parent task or workflow was cancelled',
              }
            : { startedAt: new Date() }),
        },
      });
    });

    if (agentRun.status === AgentRunStatus.CANCELLED) {
      return {
        agentRunId: agentRun.id,
        status: AgentRunStatus.CANCELLED,
        output: null,
        error: agentRun.errorMessage,
        costUsd: 0,
        budgetExceeded: false,
      };
    }

    const runLogger = logger.withContext({
      traceId: input.traceId,
      taskId: input.taskId,
      taskKey: task.key,
      agentRunId: agentRun.id,
      workflowRunId: input.workflowRunId,
    });

    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId: input.taskId,
      action: AuditAction.AGENT_STARTED,
      entityType: 'agent_run',
      entityId: agentRun.id,
      summary: `${input.role} started on ${resolution.providerKey}`,
      metadata: { model: resolution.model, workspacePath: input.workspacePath },
      traceId: input.traceId,
    });

    let result: AgentRunResult | null = null;
    let failure: { code: string; message: string } | null = null;
    let actualProviderKey = resolution.providerKey;
    let actualModel = resolution.model;
    /** Set once a credential is primed, so it is cleared on every exit path. */
    let credentialPrimed: string | null = null;

    const cancellationRequested = async (): Promise<boolean> => {
      const current = await prisma.agentRun.findUnique({
        where: { id: agentRun.id },
        select: { status: true },
      });
      if (current?.status === AgentRunStatus.CANCELLED) return true;

      const [taskState, workflowState] = await Promise.all([
        prisma.task.findUnique({ where: { id: input.taskId }, select: { status: true } }),
        input.workflowRunId
          ? prisma.workflowRun.findUnique({
              where: { id: input.workflowRunId },
              select: { status: true },
            })
          : Promise.resolve(null),
      ]);
      if (
        taskState?.status !== TaskStatus.CANCELLED &&
        workflowState?.status !== RunStatus.CANCELLED
      ) return false;

      await prisma.agentRun.updateMany({
        where: { id: agentRun.id, status: AgentRunStatus.RUNNING },
        data: {
          status: AgentRunStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Parent task or workflow was cancelled',
        },
      });
      return true;
    };

    try {
      const provider = registry.resolve({
        role: input.role,
        fallbackProviderKey: resolution.providerKey,
      });
      actualProviderKey = provider.key;
      actualModel = provider.capabilities.models[0] ?? resolution.model;

      const context = await contextBuilder.build({
        runId: agentRun.id,
        role: input.role,
        taskId: input.taskId,
        workspacePath: input.workspacePath,
        branchName: input.branchName,
        input: input.input,
        traceId: input.traceId,
        workflowRunId: input.workflowRunId,
        // Every limit the resolved agent row sets overrides the env-wide default;
        // an unset one falls through to it.
        budgetOverrides: {
          ...(resolution.agentTimeoutMs ? { timeoutMs: resolution.agentTimeoutMs } : {}),
          ...(resolution.agentMaxTokens ? { maxTokens: resolution.agentMaxTokens } : {}),
          ...(resolution.agentMaxCostUsd !== undefined
            ? { maxCostUsd: resolution.agentMaxCostUsd }
            : {}),
        },
      });

      if (await cancellationRequested()) {
        throw new Error('Agent run was cancelled before its provider started');
      }

      // Resolve this organization's stored key and prime it for the spawn. The
      // SDK reads it back synchronously from the store inside `startRun`.
      const auth = await this.resolveCliAuth(task.project.organizationId, provider.key);
      credentialStore.set(provider.key, auth);
      credentialPrimed = provider.key;

      runLogger.info(
        { provider: provider.key, role: input.role, credentialSource: auth.source },
        'agent.run.started',
      );
      let checkingCancellation = false;
      let cancellationSent = false;
      const pollCancellation = async (): Promise<void> => {
        if (checkingCancellation || cancellationSent) return;
        checkingCancellation = true;
        try {
          if (await cancellationRequested()) {
            cancellationSent = true;
            await provider.cancelRun(agentRun.id);
          }
        } catch (error) {
          runLogger.warn({ error: String(error) }, 'agent.cancel.poll_failed');
        } finally {
          checkingCancellation = false;
        }
      };
      const cancellationTimer = setInterval(() => void pollCancellation(), 250);
      try {
        result = await provider.startRun(context);
      } finally {
        clearInterval(cancellationTimer);
      }

      // Second gate: even a provider that claims success must produce output
      // that satisfies the role schema before the workflow consumes it.
      const schema = ROLE_OUTPUT_SCHEMAS[input.role as keyof typeof ROLE_OUTPUT_SCHEMAS];
      if (result.status === 'SUCCEEDED' && schema) {
        const parsed = parseSafely(schema, result.output, `${provider.key} ${input.role} output`);
        if (!parsed.ok) {
          throw new AgentOutputInvalidError(provider.key, parsed.issues, result.rawOutput ?? '');
        }
        result = { ...result, output: parsed.data };
      }
    } catch (error) {
      if (error instanceof AgentOutputInvalidError) {
        failure = { code: 'AGENT_OUTPUT_INVALID', message: error.message };
      } else if (error instanceof ProviderUnavailableError) {
        failure = { code: 'AGENT_PROVIDER_UNAVAILABLE', message: error.message };
      } else {
        failure = {
          code: 'AGENT_RUN_FAILED',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      runLogger.error({ ...failure }, 'agent.run.failed');
    } finally {
      // A decrypted key must not stay readable once this run has spawned.
      if (credentialPrimed) credentialStore.clear(credentialPrimed);
    }

    const status: AgentRunStatus = failure
      ? AgentRunStatus.FAILED
      : ((result?.status ?? AgentRunStatus.FAILED) as AgentRunStatus);

    // Serialize provider completion with API cancellation through the same task
    // row lock. If cancellation acquired it first, this transaction observes the
    // terminal parent and cannot persist output, usage, or cost as success.
    const claimed = await prisma.$transaction(async (tx) => {
      const lockedTask = await tx.$queryRaw<Array<{ status: TaskStatus }>>`
        SELECT status FROM tasks WHERE id = ${input.taskId} FOR UPDATE
      `;
      const workflowState = input.workflowRunId
        ? await tx.workflowRun.findUnique({
            where: { id: input.workflowRunId },
            select: { status: true },
          })
        : null;
      if (
        lockedTask[0]?.status === TaskStatus.CANCELLED ||
        workflowState?.status === RunStatus.CANCELLED
      ) {
        await tx.agentRun.updateMany({
          where: { id: agentRun.id, status: AgentRunStatus.RUNNING },
          data: {
            status: AgentRunStatus.CANCELLED,
            completedAt: new Date(),
            errorMessage: 'Parent task or workflow was cancelled',
          },
        });
        return { count: 0 };
      }

      return tx.agentRun.updateMany({
        where: { id: agentRun.id, status: AgentRunStatus.RUNNING },
        data: {
          providerKey: actualProviderKey,
          model: actualModel,
          status,
          sessionId: result?.sessionId ?? null,
          output: (result?.output ?? null) as Prisma.InputJsonValue,
          rawOutput: result?.rawOutput ?? null,
          errorCode: failure?.code ?? result?.error?.code ?? null,
          errorMessage: failure?.message ?? result?.error?.message ?? null,
          inputTokens: result?.usage.inputTokens ?? 0,
          outputTokens: result?.usage.outputTokens ?? 0,
          cachedTokens: result?.usage.cachedTokens ?? 0,
          totalTokens: result?.usage.totalTokens ?? 0,
          estimatedCost: result?.estimatedCostUsd ?? 0,
          completedAt: new Date(),
          durationMs: result?.durationMs ?? null,
        },
      });
    });

    if (claimed.count !== 1) {
      const cancelled = await prisma.agentRun.findUniqueOrThrow({ where: { id: agentRun.id } });
      return {
        agentRunId: agentRun.id,
        status: cancelled.status,
        output: null,
        error: cancelled.errorMessage,
        costUsd: Number(cancelled.estimatedCost),
        budgetExceeded: cancelled.status === AgentRunStatus.BUDGET_EXCEEDED,
      };
    }

    if (result?.messages.length) {
      await prisma.agentMessage.createMany({
        data: result.messages.map((message, index) => ({
          agentRunId: agentRun.id,
          role: message.role,
          content: message.content,
          sequence: index,
        })),
      });
    }

    const persisted = await prisma.agentRun.findUniqueOrThrow({ where: { id: agentRun.id } });

    if (result && result.estimatedCostUsd >= 0) {
      await usage.record({
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId: task.id,
        agentRunId: agentRun.id,
        providerKey: actualProviderKey,
        model: actualModel,
        role: input.role,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        totalTokens: result.usage.totalTokens,
        durationMs: result.durationMs,
        estimatedCostUsd: result.estimatedCostUsd,
      });
    }

    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId: input.taskId,
      action: AuditAction.AGENT_STOPPED,
      entityType: 'agent_run',
      entityId: agentRun.id,
      summary: `${input.role} finished with ${status}`,
      metadata: {
        durationMs: persisted.durationMs,
        totalTokens: persisted.totalTokens,
        costUsd: Number(persisted.estimatedCost),
      },
      traceId: input.traceId,
    });

    runLogger.info({ status, durationMs: persisted.durationMs }, 'agent.run.finished');

    return {
      agentRunId: agentRun.id,
      status,
      output: result?.output ?? null,
      error: failure?.message ?? result?.error?.message ?? null,
      costUsd: Number(persisted.estimatedCost),
      budgetExceeded: false,
    };
  }

  /**
   * Turns the organization's stored credential into the environment its CLI needs.
   *
   * A provider with no stored key yields `cli-login`, leaving the CLI on its own
   * `codex login` / `claude` session. Process-environment API keys are not
   * consulted: credentials come from the UI or not at all.
   */
  private async resolveCliAuth(organizationId: string, providerKey: string): Promise<CliAuth> {
    const { credentials, env } = this.deps;
    const apiKey = await credentials.resolve(organizationId, providerKey);

    if (providerKey === 'claude-code') return claudeCodeCliAuth(apiKey);
    if (providerKey === 'codex') return codexCliAuth(apiKey, env.CODEX_HOME);
    // Providers without CLI credentials (e.g. mock) spawn with no extra env.
    return { source: apiKey ? 'api-key' : 'cli-login', env: {} };
  }

  private async assertWorkflowOwnership(
    input: ExecuteAgentInput,
    projectId: string,
  ): Promise<void> {
    const { prisma } = this.deps;
    let workflowRunId = input.workflowRunId;

    if (input.workflowStepId) {
      const step = await prisma.workflowStep.findUnique({
        where: { id: input.workflowStepId },
        select: {
          workflowRunId: true,
          workflowRun: { select: { projectId: true, taskId: true } },
        },
      });
      if (
        !step ||
        step.workflowRun.projectId !== projectId ||
        step.workflowRun.taskId !== input.taskId ||
        (workflowRunId !== undefined && step.workflowRunId !== workflowRunId)
      ) {
        throw new Error('Workflow step does not belong to the input task and project');
      }
      workflowRunId = step.workflowRunId;
    }

    if (workflowRunId) {
      const run = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        select: { projectId: true, taskId: true },
      });
      if (!run || run.projectId !== projectId || run.taskId !== input.taskId) {
        throw new Error('Workflow run does not belong to the input task and project');
      }
    }
  }
}
