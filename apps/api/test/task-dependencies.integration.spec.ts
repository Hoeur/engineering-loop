import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TaskDependenciesService } from '../src/modules/tasks/task-dependencies.service';

const databaseUrl = process.env.ENGLOOP_PHASE_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Task dependencies PostgreSQL integration (isolated explicit DB)',
  () => {
    let prisma: ReturnType<typeof createPrismaClient>;
    let service: TaskDependenciesService;
    let audit: AuditService;
    let organizationId: string;
    let foreignOrg: string;
    let projectId: string;
    let otherProjectId: string;
    let foreignProjectId: string;
    let sequence = 0;

    const task = async (project = projectId) =>
      (
        await prisma.task.create({
          data: { projectId: project, key: `TD-${++sequence}`, title: 'Dependency fixture' },
        })
      ).id;

    beforeAll(async () => {
      prisma = createPrismaClient({ databaseUrl });
      const db = prisma as PrismaService;
      audit = new AuditService(db);
      service = new TaskDependenciesService(db, audit);
      const marker = randomUUID();
      organizationId = (
        await prisma.organization.create({
          data: { name: 'Task dependency fixture', slug: `td-${marker}` },
        })
      ).id;
      foreignOrg = (
        await prisma.organization.create({
          data: { name: 'Foreign task dependency fixture', slug: `td-foreign-${marker}` },
        })
      ).id;
      projectId = (
        await prisma.project.create({
          data: { organizationId, name: 'Task graph', slug: 'graph', key: 'TD' },
        })
      ).id;
      otherProjectId = (
        await prisma.project.create({
          data: { organizationId, name: 'Other graph', slug: 'other', key: 'OT' },
        })
      ).id;
      foreignProjectId = (
        await prisma.project.create({
          data: { organizationId: foreignOrg, name: 'Foreign graph', slug: 'foreign', key: 'FR' },
        })
      ).id;
    });
    afterAll(async () => {
      if (organizationId) await prisma.organization.delete({ where: { id: organizationId } });
      if (foreignOrg) await prisma.organization.delete({ where: { id: foreignOrg } });
      await prisma.$disconnect();
    });

    it('serializes reciprocal concurrent edges, accepting exactly one and auditing exactly once', async () => {
      const [a, b] = await Promise.all([task(), task()]);
      const results = await Promise.allSettled([
        service.add(organizationId, a, b, 'BLOCKS'),
        service.add(organizationId, b, a, 'RELATES_TO'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({ reason: { code: 'TASK_DEPENDENCY_CYCLE' } });
      expect(await prisma.taskDependency.count({ where: { taskId: { in: [a, b] } } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { taskId: { in: [a, b] }, entityType: 'taskDependency' },
        }),
      ).toBe(1);
    });

    it('rejects cycle closure beyond 500 tasks across mixed edge types', async () => {
      const nodes = Array.from({ length: 602 }, () => randomUUID());
      await prisma.task.createMany({
        data: nodes.map((id, i) => ({ id, projectId, key: `LONG-${i}`, title: 'Long path' })),
      });
      await prisma.taskDependency.createMany({
        data: nodes.slice(0, -1).map((id, i) => ({
          taskId: id,
          dependsOnTaskId: nodes[i + 1]!,
          type: i % 2 === 0 ? 'BLOCKS' : 'RELATES_TO',
        })),
      });
      await expect(
        service.add(organizationId, nodes[601]!, nodes[0]!, 'DUPLICATES'),
      ).rejects.toMatchObject({ code: 'TASK_DEPENDENCY_CYCLE' });
      expect(await prisma.taskDependency.count({ where: { taskId: nodes[601]! } })).toBe(0);
    });

    it('replays concurrent duplicate writes once, preserving the original type', async () => {
      const [a, b] = await Promise.all([task(), task()]);
      const results = await Promise.all([
        service.add(organizationId, a, b, 'BLOCKS'),
        service.add(organizationId, a, b, 'BLOCKS'),
      ]);
      expect(results[0]!.id).toBe(results[1]!.id);
      await expect(service.add(organizationId, a, b, 'DUPLICATES')).rejects.toMatchObject({
        code: 'TASK_DEPENDENCY_EXISTS',
      });
      expect(
        await prisma.auditLog.count({ where: { taskId: a, entityType: 'taskDependency' } }),
      ).toBe(1);
      expect(
        (
          await prisma.taskDependency.findUniqueOrThrow({
            where: { taskId_dependsOnTaskId: { taskId: a, dependsOnTaskId: b } },
          })
        ).type,
      ).toBe('BLOCKS');
    });

    it('enforces self, cross-project, and tenant ownership checks', async () => {
      const [a, other, foreign] = await Promise.all([
        task(),
        task(otherProjectId),
        task(foreignProjectId),
      ]);
      await expect(service.add(organizationId, a, a, 'BLOCKS')).rejects.toMatchObject({
        code: 'TASK_DEPENDENCY_CYCLE',
      });
      await expect(service.add(organizationId, a, other, 'BLOCKS')).rejects.toMatchObject({
        code: 'TASK_REFERENCE_PROJECT_MISMATCH',
      });
      await expect(service.add(organizationId, a, foreign, 'BLOCKS')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.add(foreignOrg, a, foreign, 'BLOCKS')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await prisma.taskDependency.count({ where: { taskId: a } })).toBe(0);
    });

    it('rolls back the dependency when audit persistence fails', async () => {
      const [a, b] = await Promise.all([task(), task()]);
      const failure = vi
        .spyOn(audit, 'recordInTransaction')
        .mockRejectedValueOnce(new Error('audit failure'));
      try {
        await expect(service.add(organizationId, a, b, 'BLOCKS')).rejects.toThrow('audit failure');
        expect(await prisma.taskDependency.count({ where: { taskId: a } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { taskId: a } })).toBe(0);
      } finally {
        failure.mockRestore();
      }
    });
  },
);
