import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole } from '@engloop/types';
import { workflowExecutionSnapshotSchema } from '@engloop/schemas';
import type { Env } from '@engloop/config';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExecutionSnapshotsService } from './execution-snapshots.service';
import { TasksService } from './tasks.service';

const databaseUrl = process.env.ENGLOOP_SNAPSHOT_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Workflow execution snapshot PostgreSQL contract', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let org: string;
  let project: string;
  let task: string;
  let agent: string;
  let template: string;
  const start = vi.fn().mockResolvedValue(undefined);
  const env = {
    AGENT_DEFAULT_PROVIDER: 'mock',
    AGENT_RUN_TIMEOUT_MS: 10000,
    AGENT_TOKEN_BUDGET: 1000,
    AGENT_COST_BUDGET_USD: 2,
    COMMAND_ALLOWLIST: ['git', 'pnpm'],
    CODEX_MODEL: 'gpt-test',
    CLAUDE_CODE_MODEL: 'claude-test',
  } as Env;
  const service = (audit?: AuditService) =>
    new TasksService(
      prisma as PrismaService,
      { publish: vi.fn() } as never,
      audit ?? new AuditService(prisma as PrismaService),
      {} as never,
      { start } as never,
      {} as never,
      undefined,
      new ExecutionSnapshotsService(env),
    );
  const capture = async () =>
    service().run(org, task, {
      workflowKey: 'engineering-task',
      skipPlanning: true,
      force: true,
      execution: { prompts: [{ role: AgentRole.IMPLEMENTER, templateId: template, revision: 1 }] },
    });

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    org = (
      await prisma.organization.create({
        data: {
          name: 'Snapshot test',
          slug: `snapshot-${randomUUID()}`,
          defaultProviderKey: 'mock',
        },
      })
    ).id;
    project = (
      await prisma.project.create({
        data: {
          organizationId: org,
          name: 'Snapshot project',
          slug: 'snapshots',
          key: 'SNAP',
          settings: { documentation: { enabled: false } },
        },
      })
    ).id;
    const provider = await prisma.agentProvider.create({
      data: {
        organizationId: org,
        key: 'mock',
        displayName: 'Mock',
        kind: 'MOCK',
        defaultModel: 'pinned-model',
        encryptedCredential: 'NEVER_CAPTURE_SECRET',
        configuration: { apiKey: 'NEVER_CAPTURE_CONFIG' },
      },
    });
    agent = (
      await prisma.agent.create({
        data: {
          organizationId: org,
          projectId: project,
          providerId: provider.id,
          name: 'Implementer',
          role: AgentRole.IMPLEMENTER,
          systemPrompt: 'Pinned system',
          timeoutMs: 50000,
          maxTokens: 2000,
          maxCostUsd: 3,
          allowedCommands: ['git', 'curl'],
          permissionLevel: 'LEVEL_5_DEPLOY',
          configurations: { create: { version: 1, values: { token: 'NEVER_CAPTURE_VALUES' } } },
        },
      })
    ).id;
    task = (
      await prisma.task.create({
        data: {
          projectId: project,
          key: 'SNAP-101',
          title: 'Original title',
          description: 'Original requirement',
        },
      })
    ).id;
    template = (
      await prisma.promptTemplate.create({
        data: {
          projectId: project,
          name: 'Implement',
          role: AgentRole.IMPLEMENTER,
          revisions: {
            create: { revision: 1, body: 'Implement {{task.title}} for {{project.name}}' },
          },
        },
      })
    ).id;
    await prisma.projectMemory.create({
      data: { projectId: project, kind: 'CONVENTIONS', content: 'Pinned memory' },
    });
    await prisma.artifact.create({
      data: { taskId: task, name: 'Prior plan', content: 'Prior plan content' },
    });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.organization.delete({ where: { id: org } });
      await prisma.$disconnect();
    }
  });

  it('captures narrowed policy, prompt revision and safe inputs atomically before queue dispatch', async () => {
    start.mockImplementationOnce(async (input: { workflowRunId: string }) => {
      const persisted = await prisma.workflowRun.findUniqueOrThrow({
        where: { id: input.workflowRunId },
      });
      expect(workflowExecutionSnapshotSchema.safeParse(persisted.executionSnapshot).success).toBe(
        true,
      );
      expect(
        await prisma.auditLog.count({
          where: { entityId: persisted.id, entityType: 'WorkflowExecutionSnapshot' },
        }),
      ).toBe(1);
    });
    const run = await capture();
    const snapshot = workflowExecutionSnapshotSchema.parse(run.executionSnapshot);
    const implementation = snapshot.roles.find((role) => role.role === AgentRole.IMPLEMENTER)!;
    expect(implementation).toMatchObject({
      agentId: agent,
      model: 'pinned-model',
      systemPrompt: 'Pinned system',
      permissionLevel: 'LEVEL_3_PR',
      budget: { timeoutMs: 10000, maxTokens: 1000, maxCostUsd: 2, allowedCommands: ['git'] },
      prompt: { revision: 1, rendered: 'Implement Original title for Snapshot project' },
    });
    expect(implementation.configurationVersions).toHaveLength(1);
    expect(snapshot.memories[0]?.content).toBe('Pinned memory');
    expect(snapshot.artifacts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('NEVER_CAPTURE');
    expect(snapshot.task).not.toHaveProperty('worktreePath');
    expect(
      await prisma.auditLog.count({
        where: { entityId: run.id, entityType: 'WorkflowExecutionSnapshot' },
      }),
    ).toBe(1);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ workflowRunId: run.id }));
    await prisma.task.update({ where: { id: task }, data: { title: 'Changed after capture' } });
    await prisma.agent.update({
      where: { id: agent },
      data: { systemPrompt: 'Changed system', model: 'Changed model' },
    });
    const stored = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.executionSnapshot).toEqual(run.executionSnapshot);
    await expect(
      prisma.workflowRun.update({ where: { id: run.id }, data: { executionSnapshot: {} } }),
    ).rejects.toThrow();
  });

  it('rejects cross-project prompt selection without run or enqueue', async () => {
    const other = await prisma.project.create({
      data: { organizationId: org, name: 'Other', slug: 'other', key: 'OTHER' },
    });
    const foreign = await prisma.promptTemplate.create({
      data: {
        projectId: other.id,
        name: 'Foreign',
        role: AgentRole.IMPLEMENTER,
        revisions: { create: { revision: 1, body: 'Foreign' } },
      },
    });
    const before = await prisma.workflowRun.count({ where: { taskId: task } });
    start.mockClear();
    await expect(
      service().run(org, task, {
        workflowKey: 'engineering-task',
        skipPlanning: true,
        force: true,
        execution: {
          prompts: [{ role: AgentRole.IMPLEMENTER, templateId: foreign.id, revision: 1 }],
        },
      }),
    ).rejects.toThrow('was not found');
    expect(await prisma.workflowRun.count({ where: { taskId: task } })).toBe(before);
    expect(start).not.toHaveBeenCalled();
  });

  it('rolls back run and snapshot on transactional audit failure', async () => {
    const audit = new AuditService(prisma as PrismaService);
    vi.spyOn(audit, 'recordInTransaction').mockRejectedValue(new Error('audit write failed'));
    const before = await prisma.workflowRun.count({ where: { taskId: task } });
    start.mockClear();
    await expect(
      service(audit).run(org, task, {
        workflowKey: 'engineering-task',
        skipPlanning: true,
        force: true,
        execution: { prompts: [] },
      }),
    ).rejects.toThrow('audit write failed');
    expect(await prisma.workflowRun.count({ where: { taskId: task } })).toBe(before);
    expect(start).not.toHaveBeenCalled();
  });

  it('fails closed for configured rosters instead of selecting outside the team', async () => {
    await prisma.project.update({ where: { id: project }, data: { teamConfigured: true } });
    start.mockClear();
    try {
      await expect(capture()).rejects.toMatchObject({ code: 'PROJECT_TEAM_ROLE_UNCOVERED' });
    } finally {
      await prisma.project.update({ where: { id: project }, data: { teamConfigured: false } });
    }
    expect(start).not.toHaveBeenCalled();
  });

  it('leaves legacy starts without an execution snapshot', async () => {
    const run = await service().run(org, task, {
      workflowKey: 'engineering-task',
      skipPlanning: true,
      force: true,
    });
    expect(run.executionSnapshot).toBeNull();
  });

  it('serializes competing snapshot starts so only one active run is queued', async () => {
    const concurrent = await prisma.task.create({
      data: { projectId: project, key: 'SNAP-102', title: 'Concurrent start' },
    });
    start.mockClear();
    const request = () =>
      service().run(org, concurrent.id, {
        workflowKey: 'engineering-task',
        skipPlanning: true,
        force: false,
        execution: { prompts: [] },
      });
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status !== 'rejected') throw new Error('Expected a rejected concurrent start');
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(['WORKFLOW_SNAPSHOT_CONFLICT', 'TASK_ALREADY_RUNNING']).toContain(
      (rejected.reason as { code: string }).code,
    );
    expect(await prisma.workflowRun.count({ where: { taskId: concurrent.id } })).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
