import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { upsertAgentSchema } from '@engloop/schemas';
import {
  AgentRole,
  CheckType,
  OrgRole,
  ProjectPhaseStatus,
  RunStatus,
  TaskStatus,
} from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AgentsService } from '../src/modules/agents/agents.service';
import { TaskEditingService } from '../src/modules/tasks/task-editing.service';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { TestsService } from '../src/modules/tests/tests.service';

const databaseUrl = process.env.ENGLOOP_EDITORS_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Configuration editors on an explicit scratch PostgreSQL database',
  () => {
    let prisma: ReturnType<typeof createPrismaClient>;
    let org: string;
    let project: string;
    let foreign: string;
    let provider: string;
    let editing: TaskEditingService;
    let agents: AgentsService;
    const newTask = () =>
      prisma.task.create({
        data: {
          projectId: project,
          key: randomUUID(),
          title: 'Original task',
          planSummary: 'Old plan',
          plan: { summary: 'Old plan' },
        },
      });
    const newAgent = () =>
      agents.create(
        org,
        OrgRole.OWNER,
        upsertAgentSchema.parse({
          organizationId: org,
          name: `Editor ${randomUUID()}`,
          providerKey: 'mock',
          role: AgentRole.IMPLEMENTER,
          configuration: { apiKey: 'AGENT_CONFIG_MUST_NOT_LEAK' },
        }),
      );
    beforeAll(async () => {
      prisma = createPrismaClient({ databaseUrl });
      const audit = new AuditService(prisma as PrismaService);
      editing = new TaskEditingService(prisma as PrismaService, audit);
      agents = new AgentsService(prisma as PrismaService, audit);
      org = (
        await prisma.organization.create({
          data: { name: 'Editor acceptance', slug: `editors-${randomUUID()}` },
        })
      ).id;
      foreign = (
        await prisma.organization.create({
          data: { name: 'Foreign editor org', slug: `foreign-editors-${randomUUID()}` },
        })
      ).id;
      project = (
        await prisma.project.create({
          data: { organizationId: org, name: 'Editor project', slug: 'editors', key: 'ED' },
        })
      ).id;
      provider = (
        await prisma.agentProvider.create({
          data: {
            organizationId: org,
            key: 'mock',
            displayName: 'Mock',
            kind: 'MOCK',
            defaultModel: 'original-model',
            encryptedCredential: 'CREDENTIAL_MUST_NOT_LEAK',
            configuration: { secret: 'CONFIG_MUST_NOT_LEAK' },
          },
        })
      ).id;
    });
    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('lets only one concurrent task editor win and preserves historical runs', async () => {
      const task = await newTask();
      const history = await prisma.workflowRun.create({
        data: {
          taskId: task.id,
          projectId: project,
          definitionKey: 'engineering-task',
          status: RunStatus.SUCCEEDED,
          state: {},
          idempotencyKey: randomUUID(),
          executionSnapshot: { version: 1, originalTitle: task.title },
        },
      });
      const results = await Promise.allSettled(
        ['First edit', 'Second edit'].map((title) =>
          editing.update(org, task.id, { title, expectedUpdatedAt: task.updatedAt.toISOString() }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      expect(failure?.status === 'rejected' && failure.reason).toMatchObject({ code: 'CONFLICT' });
      const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(saved.plan).toBeNull();
      expect(saved.planSummary).toBeNull();
      expect(saved.status).toBe(TaskStatus.BACKLOG);
      expect(
        (await prisma.workflowRun.findUniqueOrThrow({ where: { id: history.id } }))
          .executionSnapshot,
      ).toEqual(history.executionSnapshot);
      expect(await prisma.auditLog.count({ where: { taskId: task.id, entityType: 'task' } })).toBe(
        1,
      );
    });
    it('serializes edit/start races without capturing mixed input', async () => {
      const task = await newTask();
      const start = vi.fn().mockResolvedValue(undefined);
      const service = new TasksService(
        prisma as PrismaService,
        { publish: vi.fn() } as never,
        new AuditService(prisma as PrismaService),
        {} as never,
        { start } as never,
        {} as never,
      );
      const [editResult, runResult] = await Promise.allSettled([
        editing.update(org, task.id, {
          description: 'Updated requirement',
          expectedUpdatedAt: task.updatedAt.toISOString(),
        }),
        service.run(org, task.id, {
          workflowKey: 'engineering-task',
          skipPlanning: true,
          force: false,
        }),
      ]);
      expect(runResult.status).toBe('fulfilled');
      const run = await prisma.workflowRun.findFirstOrThrow({ where: { taskId: task.id } });
      const state = run.state as { requirement: string };
      if (editResult.status === 'fulfilled') expect(state.requirement).toBe('Updated requirement');
      else {
        expect(editResult.reason).toMatchObject({ code: 'TASK_EDIT_LOCKED' });
        expect(state.requirement).toBe(task.description);
      }
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: RunStatus.CANCELLED },
      });
    });
    it('rolls back the task edit when its audit cannot be recorded', async () => {
      const task = await newTask();
      const fail = new TaskEditingService(
        prisma as PrismaService,
        { recordInTransaction: vi.fn().mockRejectedValue(new Error('audit unavailable')) } as never,
      );
      await expect(
        fail.update(org, task.id, {
          title: 'Must roll back',
          expectedUpdatedAt: task.updatedAt.toISOString(),
        }),
      ).rejects.toThrow('audit unavailable');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe(
        task.title,
      );
    });
    it('serializes edits against standalone check creation using current requirements', async () => {
      const task = await newTask();
      const tests = new TestsService(prisma as PrismaService, { enqueue: vi.fn() } as never);
      const [editResult, runResult] = await Promise.allSettled([
        editing.update(org, task.id, {
          requiredChecks: [CheckType.LINT],
          expectedUpdatedAt: task.updatedAt.toISOString(),
        }),
        tests.trigger(org, task.id, []),
      ]);
      expect(runResult.status).toBe('fulfilled');
      const run = await prisma.testRun.findFirstOrThrow({
        where: { taskId: task.id },
        include: { results: true },
      });
      if (editResult.status === 'fulfilled')
        expect(run.results.map((result) => result.checkType)).toEqual([CheckType.LINT]);
      else expect(editResult.reason).toMatchObject({ code: 'TASK_EDIT_LOCKED' });
      await prisma.testRun.delete({ where: { id: run.id } });
    });
    it('refuses cross-tenant, queued and accepted-phase edits', async () => {
      const phase = await prisma.projectPhase.create({
        data: {
          projectId: project,
          name: 'Accepted phase',
          position: 1,
          status: ProjectPhaseStatus.ACCEPTED,
        },
      });
      for (const data of [{ status: TaskStatus.QUEUED }, { phaseId: phase.id }]) {
        const task = await prisma.task.create({
          data: { ...data, projectId: project, key: randomUUID(), title: 'Locked task' },
        });
        await expect(
          editing.update(org, task.id, {
            title: 'Forbidden edit',
            expectedUpdatedAt: task.updatedAt.toISOString(),
          }),
        ).rejects.toMatchObject({ code: 'TASK_EDIT_LOCKED' });
        await expect(
          editing.update(foreign, task.id, {
            title: 'Foreign edit',
            expectedUpdatedAt: task.updatedAt.toISOString(),
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await prisma.task.delete({ where: { id: task.id } });
      }
      await prisma.task.deleteMany({ where: { phaseId: phase.id } });
      await prisma.projectPhase.delete({ where: { id: phase.id } });
    });
    it('creates and edits an agent without returning provider secrets or auditing prompt contents', async () => {
      const agent = await newAgent();
      expect(agent.model).toBe('original-model');
      expect(JSON.stringify(agent)).not.toContain('MUST_NOT_LEAK');
      const editor = await agents.editor(org, OrgRole.OWNER, agent.id);
      expect(JSON.stringify(editor)).not.toContain('MUST_NOT_LEAK');
      expect(editor).not.toHaveProperty('configurations');
      expect(editor).not.toHaveProperty('runs');
      await expect(agents.editor(foreign, OrgRole.OWNER, agent.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(agents.editor(org, OrgRole.MEMBER, agent.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const updated = await agents.update(org, OrgRole.ADMIN, agent.id, {
        name: 'Changed agent',
        systemPrompt: 'PRIVATE_PROMPT_CONTENT',
        model: '',
        expectedUpdatedAt: agent.updatedAt.toISOString(),
      });
      expect(updated.model).toBeNull();
      expect(updated.systemPrompt).toBe('PRIVATE_PROMPT_CONTENT');
      expect(JSON.stringify(updated)).not.toContain('MUST_NOT_LEAK');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: agent.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit)).not.toContain('PRIVATE_PROMPT_CONTENT');
      expect(audit.metadata).toEqual({ fields: ['name', 'systemPrompt', 'model'] });
    });
    it('makes concurrent agent edits conflict and enforces authenticated ownership/administrator rights', async () => {
      const agent = await newAgent();
      const results = await Promise.allSettled(
        ['First agent', 'Second agent'].map((name) =>
          agents.update(org, OrgRole.OWNER, agent.id, {
            name,
            expectedUpdatedAt: agent.updatedAt.toISOString(),
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(
        agents.update(foreign, OrgRole.OWNER, agent.id, { name: 'Foreign' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        agents.update(org, OrgRole.MEMBER, agent.id, { name: 'Forbidden' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        agents.create(
          org,
          OrgRole.MEMBER,
          upsertAgentSchema.parse({
            organizationId: org,
            name: 'Forbidden',
            role: AgentRole.PLANNER,
            providerKey: 'mock',
          }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('locks structural agent edits during live work but permits explicit revocation', async () => {
      const agent = await newAgent();
      const task = await newTask();
      const run = await prisma.workflowRun.create({
        data: {
          taskId: task.id,
          projectId: project,
          definitionKey: 'engineering-task',
          status: RunStatus.WAITING_FOR_HUMAN,
          state: {},
          idempotencyKey: randomUUID(),
        },
      });
      try {
        await expect(
          agents.update(org, OrgRole.OWNER, agent.id, {
            model: 'new-model',
            expectedUpdatedAt: agent.updatedAt.toISOString(),
          }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(
          (await agents.update(org, OrgRole.OWNER, agent.id, { enabled: false })).enabled,
        ).toBe(false);
      } finally {
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: RunStatus.CANCELLED },
        });
      }
    });
    it('refuses disabled providers and foreign project scope', async () => {
      await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: false } });
      try {
        await expect(newAgent()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      } finally {
        await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: true } });
      }
      const other = await prisma.project.create({
        data: { organizationId: foreign, name: 'Foreign project', slug: 'foreign', key: 'FR' },
      });
      await expect(
        agents.create(
          org,
          OrgRole.OWNER,
          upsertAgentSchema.parse({
            organizationId: org,
            projectId: other.id,
            name: 'Foreign scope',
            role: AgentRole.PLANNER,
            providerKey: 'mock',
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    it('rolls back agent creation and update when auditing fails', async () => {
      const fail = new AgentsService(
        prisma as PrismaService,
        {
          recordInTransaction: vi.fn().mockRejectedValue(new Error('audit unavailable')),
        } as never,
      );
      const agent = await newAgent();
      await expect(
        fail.update(org, OrgRole.OWNER, agent.id, {
          name: 'Must roll back',
          expectedUpdatedAt: agent.updatedAt.toISOString(),
        }),
      ).rejects.toThrow('audit unavailable');
      expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).name).toBe(
        agent.name,
      );
      const name = `Rollback ${randomUUID()}`;
      await expect(
        fail.create(
          org,
          OrgRole.OWNER,
          upsertAgentSchema.parse({
            organizationId: org,
            name,
            role: AgentRole.PLANNER,
            providerKey: 'mock',
          }),
        ),
      ).rejects.toThrow('audit unavailable');
      expect(await prisma.agent.count({ where: { organizationId: org, name } })).toBe(0);
    });
  },
);
