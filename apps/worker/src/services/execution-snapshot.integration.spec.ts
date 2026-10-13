import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient, type Prisma, type PrismaClient } from '@engloop/db';
import type { Env } from '@engloop/config';
import type { AgentTaskContext } from '@engloop/schemas';
import { agentRunResultSchema } from '@engloop/schemas';
import { AgentRole, AgentRunStatus, RunStatus } from '@engloop/types';
import { AgentExecutor } from './agent-executor';
import { ContextBuilder } from './context-builder';
import { UsageRecorder } from './usage-recorder';
import { snapshotFixture } from './execution-snapshot.fixture';
import { WorkflowEngine } from '../workflow/workflow-engine';
import { STEP_HANDLERS, type StepExecutionContext } from '../workflow/steps';

const databaseUrl = process.env.ENGLOOP_SNAPSHOT_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('execution snapshot PostgreSQL regressions', () => {
  let prisma: PrismaClient;
  let workspacePath: string;
  const organizations: string[] = [];
  const json = (value: unknown): Prisma.InputJsonValue =>
    JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    workspacePath = await mkdtemp(join(tmpdir(), 'engloop-snapshot-'));
  });
  afterEach(async () => {
    for (const organizationId of organizations.splice(0)) {
      await prisma.project.deleteMany({ where: { organizationId } });
      await prisma.agent.deleteMany({ where: { organizationId } });
      await prisma.agentProvider.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(workspacePath, { recursive: true, force: true });
  });

  async function fixture(
    snapshotTransform?: (value: ReturnType<typeof snapshotFixture>) => unknown,
  ) {
    const organization = await prisma.organization.create({
      data: { name: 'Snapshot tests', slug: `snapshot-${randomUUID()}` },
    });
    organizations.push(organization.id);
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: 'Original project',
        slug: 'snapshot',
        key: 'ENG',
        costBudgetUsd: 5,
      },
    });
    const provider = await prisma.agentProvider.create({
      data: {
        organizationId: organization.id,
        key: 'snapshot-mock',
        displayName: 'Snapshot mock',
        kind: 'MOCK',
      },
    });
    const agent = await prisma.agent.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        providerId: provider.id,
        name: 'Snapshot implementer',
        role: AgentRole.IMPLEMENTER,
        model: 'original-model',
        systemPrompt: 'Original system instruction',
        timeoutMs: 5000,
        maxTokens: 1000,
        maxCostUsd: 2,
        allowedCommands: ['pnpm', 'git'],
      },
    });
    const task = await prisma.task.create({
      data: { projectId: project.id, key: 'ENG-101', title: 'Original task' },
    });
    const snapshot = snapshotFixture({
      organizationId: organization.id,
      projectId: project.id,
      taskId: task.id,
      agentId: agent.id,
      providerId: provider.id,
    });
    const run = await prisma.workflowRun.create({
      data: {
        projectId: project.id,
        taskId: task.id,
        definitionKey: 'engineering-task',
        idempotencyKey: randomUUID(),
        status: RunStatus.RUNNING,
        executionSnapshot: json(snapshotTransform ? snapshotTransform(snapshot) : snapshot),
      },
    });
    const env = {
      AGENT_RUN_TIMEOUT_MS: 10000,
      AGENT_TOKEN_BUDGET: 2000,
      AGENT_COST_BUDGET_USD: 4,
      COMMAND_ALLOWLIST: ['pnpm', 'git'],
      GIT_DEFAULT_BASE_BRANCH: 'main',
    } as Env;
    const contextBuilder = new ContextBuilder(prisma, env);
    const resolveRole = vi.spyOn(contextBuilder, 'resolveRoleProvider');
    const credentials = { resolve: vi.fn() };
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), withContext: vi.fn() };
    logger.withContext.mockReturnValue(logger);
    const startRun = vi.fn(async (context: AgentTaskContext) =>
      agentRunResultSchema.parse({
        runId: context.runId,
        status: 'SUCCEEDED',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        output: {
          taskId: task.id,
          status: 'implementation_complete',
          summary: 'Completed mock verification',
        },
        estimatedCostUsd: 1,
      }),
    );
    const registeredProvider = {
      key: provider.key,
      kind: 'MOCK',
      capabilities: {
        models: ['incorrect-registry-default'],
        roles: [AgentRole.IMPLEMENTER],
        executesCommands: false,
      },
      startRun,
      cancelRun: vi.fn(),
    };
    const executionRuntime = { prepare: vi.fn(), release: vi.fn(), cancel: vi.fn() };
    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: vi.fn(() => registeredProvider) },
      logger,
      env,
      contextBuilder,
      usage: new UsageRecorder(prisma),
      audit: { record: vi.fn() },
      credentials,
      executionRuntime,
    } as never);
    const execute = () =>
      executor.execute({
        taskId: task.id,
        workflowRunId: run.id,
        role: AgentRole.IMPLEMENTER,
        input: { title: snapshot.task.title },
        workspacePath,
        traceId: randomUUID(),
      });
    return {
      organization,
      project,
      provider,
      agent,
      task,
      run,
      snapshot,
      env,
      startRun,
      resolveRole,
      credentials,
      registeredProvider,
      executionRuntime,
      execute,
    };
  }

  it('uses frozen prompt, model and memory after edits and persists the invocation before the provider starts', async () => {
    const f = await fixture();
    await prisma.project.update({
      where: { id: f.project.id },
      data: {
        name: 'Edited project',
        costBudgetUsd: 100,
        roleAssignments: { IMPLEMENTER: 'foreign-agent' },
      },
    });
    await prisma.projectMemory.create({
      data: {
        projectId: f.project.id,
        kind: 'ARCHITECTURE',
        version: 2,
        content: 'Edited architecture',
        active: true,
      },
    });
    await prisma.agent.update({
      where: { id: f.agent.id },
      data: {
        model: 'edited-model',
        systemPrompt: 'Edited system instruction',
        maxTokens: 10000,
        timeoutMs: 100000,
        maxCostUsd: 100,
      },
    });
    f.startRun.mockImplementationOnce(async (context) => {
      const persisted = await prisma.agentRun.findUniqueOrThrow({ where: { id: context.runId } });
      expect(persisted.executionSnapshot).toEqual({ version: 1, context: json(context) });
      expect(context.project.name).toBe('Original project');
      expect(context.memory.architecture).toBe('Original architecture');
      expect(context.execution).toMatchObject({
        model: 'original-model',
        systemPrompt: 'Original system instruction',
        prompt: { revision: 1, body: 'Task Original task' },
      });
      expect(context.budget).toEqual(f.snapshot.roles[0]!.budget);
      return agentRunResultSchema.parse({
        runId: context.runId,
        status: 'SUCCEEDED',
        output: { taskId: f.task.id, status: 'implementation_complete', summary: 'Mock complete' },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        estimatedCostUsd: 1,
      });
    });
    const outcome = await f.execute();
    expect(outcome.status).toBe(AgentRunStatus.SUCCEEDED);
    expect(f.resolveRole).not.toHaveBeenCalled();
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: outcome.agentRunId } })).model,
    ).toBe('original-model');
    await expect(
      prisma.workflowRun.update({
        where: { id: f.run.id },
        data: { executionSnapshot: json({ ...f.snapshot, capturedAt: new Date().toISOString() }) },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.agentRun.update({
        where: { id: outcome.agentRunId },
        data: { executionSnapshot: { version: 1, context: {} } },
      }),
    ).rejects.toThrow();
  });

  it.each(['provider', 'agent', 'membership'] as const)(
    'fails before credentials or provider invocation when %s is revoked',
    async (kind) => {
      const f = await fixture();
      if (kind === 'provider')
        await prisma.agentProvider.update({
          where: { id: f.provider.id },
          data: { enabled: false },
        });
      if (kind === 'agent')
        await prisma.agent.update({ where: { id: f.agent.id }, data: { enabled: false } });
      if (kind === 'membership')
        await prisma.project.update({
          where: { id: f.project.id },
          data: { teamConfigured: true },
        });
      await expect(f.execute()).rejects.toThrow(/disabled|not enabled/);
      expect(f.credentials.resolve).not.toHaveBeenCalled();
      expect(f.startRun).not.toHaveBeenCalled();
      expect(f.resolveRole).not.toHaveBeenCalled();
      expect(await prisma.agentRun.count({ where: { taskId: f.task.id } })).toBe(0);
    },
  );

  it.each(['malformed', 'foreign'] as const)(
    'rejects a %s snapshot without legacy fallback',
    async (kind) => {
      const f = await fixture((snapshot) =>
        kind === 'malformed' ? { version: 1 } : { ...snapshot, organizationId: 'foreign' },
      );
      await expect(f.execute()).rejects.toThrow();
      expect(f.resolveRole).not.toHaveBeenCalled();
      expect(f.startRun).not.toHaveBeenCalled();
      expect(f.credentials.resolve).not.toHaveBeenCalled();
    },
  );

  it('narrows frozen limits by current agent and worker policy', async () => {
    const f = await fixture();
    f.env.AGENT_TOKEN_BUDGET = 200;
    f.env.COMMAND_ALLOWLIST = ['pnpm'];
    await prisma.agent.update({
      where: { id: f.agent.id },
      data: {
        timeoutMs: 500,
        maxCostUsd: 0.25,
        allowedCommands: ['pnpm'],
        permissionLevel: 'LEVEL_1_PLAN',
      },
    });
    expect((await f.execute()).status).toBe(AgentRunStatus.SUCCEEDED);
    const context = f.startRun.mock.calls[0]![0];
    expect(context.budget).toEqual({
      timeoutMs: 500,
      maxTokens: 200,
      maxCostUsd: 0.25,
      allowedCommands: ['pnpm'],
    });
    expect(context.project.permissionLevel).toBe('LEVEL_1_PLAN');
  });

  it('counts live spending against the frozen ceiling even after the project budget increases', async () => {
    const f = await fixture();
    await prisma.project.update({ where: { id: f.project.id }, data: { costBudgetUsd: 100 } });
    expect((await f.execute()).status).toBe(AgentRunStatus.SUCCEEDED);
    expect(
      Number((await prisma.task.findUniqueOrThrow({ where: { id: f.task.id } })).actualCost),
    ).toBe(1);
    await prisma.task.update({ where: { id: f.task.id }, data: { actualCost: 5 } });
    expect((await f.execute()).status).toBe(AgentRunStatus.BUDGET_EXCEEDED);
    expect(f.startRun).toHaveBeenCalledTimes(1);
  });

  it('honors live workflow cancellation before invoking its frozen provider', async () => {
    const f = await fixture();
    await prisma.workflowRun.update({
      where: { id: f.run.id },
      data: { status: RunStatus.CANCELLED },
    });
    expect((await f.execute()).status).toBe(AgentRunStatus.CANCELLED);
    expect(f.startRun).not.toHaveBeenCalled();
    expect(f.credentials.resolve).not.toHaveBeenCalled();
  });

  it('narrows invocation cost to the live remaining project budget', async () => {
    const f = await fixture();
    await prisma.project.update({ where: { id: f.project.id }, data: { costBudgetUsd: 1.01 } });
    await prisma.task.update({ where: { id: f.task.id }, data: { actualCost: 1 } });
    await f.execute();
    expect(f.startRun).toHaveBeenCalledTimes(1);
    expect(f.startRun.mock.calls[0]![0].budget.maxCostUsd).toBeCloseTo(0.01, 10);
  });

  it('refuses a Codex command policy that cannot enforce the frozen restriction before credential access', async () => {
    const f = await fixture((snapshot) => {
      snapshot.roles[0]!.providerKind = 'CODEX';
      snapshot.roles[0]!.budget.allowedCommands = ['git'];
      return snapshot;
    });
    await expect(f.execute()).rejects.toThrow(
      'cannot enforce a narrowed snapshot command allowlist',
    );
    expect(f.credentials.resolve).not.toHaveBeenCalled();
    expect(f.startRun).not.toHaveBeenCalled();
    expect(await prisma.agentRun.count({ where: { taskId: f.task.id } })).toBe(0);
  });

  it('refuses Codex when a live agent narrows a previously unrestricted captured command policy', async () => {
    const f = await fixture((snapshot) => {
      snapshot.roles[0]!.providerKind = 'CODEX';
      return snapshot;
    });
    await prisma.agentProvider.update({ where: { id: f.provider.id }, data: { kind: 'CODEX' } });
    await prisma.agent.update({ where: { id: f.agent.id }, data: { allowedCommands: ['git'] } });
    f.registeredProvider.kind = 'CODEX';
    f.registeredProvider.capabilities.executesCommands = true;
    const outcome = await f.execute();
    expect(outcome.status).toBe(AgentRunStatus.FAILED);
    expect(outcome.error).toContain('cannot enforce a narrowed snapshot command allowlist');
    expect(f.credentials.resolve).not.toHaveBeenCalled();
    expect(f.executionRuntime.prepare).not.toHaveBeenCalled();
    expect(f.startRun).not.toHaveBeenCalled();
  });

  it('passes frozen task and policy plus same-run planning requirements through the real engine', async () => {
    const f = await fixture();
    await prisma.task.update({
      where: { id: f.task.id },
      data: {
        title: 'Edited task',
        objective: 'Edited objective',
        acceptanceCriteria: ['Edited criterion'],
        requiredChecks: ['LINT'],
        maxAttempts: 99,
        status: 'IMPLEMENTING',
      },
    });
    await prisma.project.update({
      where: { id: f.project.id },
      data: {
        maxReviewCycles: 99,
        settings: { uiQa: { enabled: true }, documentation: { enabled: true } },
      },
    });
    const plan = {
      summary: 'Plan',
      approach: 'Verify change',
      tasks: [{ title: 'Implement', objective: 'Verify behavior' }],
      acceptanceCriteria: ['Planner criterion'],
      requiredChecks: ['UNIT', 'E2E'],
    };
    await prisma.workflowStep.createMany({
      data: (['ANALYZE_REPOSITORY', 'PLAN', 'CREATE_TASKS', 'CREATE_WORKTREE'] as const).map(
        (stepKey, sequence) => ({
          workflowRunId: f.run.id,
          stepKey,
          sequence,
          status: RunStatus.SUCCEEDED,
          output: stepKey === 'PLAN' ? json(plan) : {},
          finishedAt: new Date(),
        }),
      ),
    });
    const contexts: StepExecutionContext[] = [];
    const handler = vi.spyOn(STEP_HANDLERS, 'IMPLEMENT').mockImplementation(async (context) => {
      contexts.push(context);
      return { status: RunStatus.SKIPPED };
    });
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), withContext: vi.fn() };
    logger.withContext.mockReturnValue(logger);
    const engine = new WorkflowEngine({ prisma, logger, audit: { record: vi.fn() } } as never);
    try {
      const result = await engine.advance(f.run.id, randomUUID());
      expect(result.stepKey).toBe('IMPLEMENT');
      expect(result.status).toBe(RunStatus.SKIPPED);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.task).toMatchObject({
        title: 'Original task',
        objective: 'Original objective',
        acceptanceCriteria: ['Original criterion', 'Planner criterion'],
        requiredChecks: ['TYPECHECK', 'UNIT', 'E2E'],
        maxAttempts: 3,
      });
      expect(contexts[0]!.state).toMatchObject({
        maxAttempts: 3,
        maxReviewCycles: 3,
        uiQaEnabled: false,
        documentationEnabled: false,
      });
    } finally {
      handler.mockRestore();
    }
  });
});
