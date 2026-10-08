import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { TaskDependenciesService } from './task-dependencies.service';

function fixture() {
  const tx = {
    task: { findFirst: vi.fn().mockResolvedValue({ projectId: 'project' }) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'project' }]),
    taskDependency: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'edge', type: 'BLOCKS' }),
    },
  };
  const prisma = { $transaction: vi.fn((run: (client: unknown) => Promise<unknown>) => run(tx)) };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const service = new TaskDependenciesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, tx, audit, prisma };
}

describe('TaskDependenciesService', () => {
  it('locks the owned project before rechecking both endpoints and atomically audits the edge', async () => {
    const { service, tx, audit, prisma } = fixture();
    await service.add('org', 'task', 'dependency', 'BLOCKS');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 30_000,
      timeout: 30_000,
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.task.findFirst.mock.invocationCallOrder[1]!,
    );
    expect(tx.task.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'task', projectId: 'project', project: { organizationId: 'org' } },
      select: { projectId: true },
    });
    expect(tx.task.findFirst).toHaveBeenNthCalledWith(3, {
      where: { id: 'dependency', project: { organizationId: 'org' } },
      select: { projectId: true },
    });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org',
        projectId: 'project',
        taskId: 'task',
        entityId: 'edge',
      }),
    );
  });

  it.each(['source', 'project', 'rechecked source', 'dependency'])(
    'rejects a missing %s without creating an edge',
    async (missing) => {
      const { service, tx } = fixture();
      if (missing === 'project') tx.$queryRaw.mockResolvedValue([]);
      else {
        const position = missing === 'source' ? 0 : missing === 'rechecked source' ? 1 : 2;
        for (let i = 0; i < position; i++)
          tx.task.findFirst.mockResolvedValueOnce({ projectId: 'project' });
        tx.task.findFirst.mockResolvedValueOnce(null);
      }
      await expect(service.add('org', 'task', 'dependency', 'BLOCKS')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(tx.taskDependency.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a same-tenant cross-project endpoint', async () => {
    const { service, tx } = fixture();
    tx.task.findFirst
      .mockResolvedValueOnce({ projectId: 'project' })
      .mockResolvedValueOnce({ projectId: 'project' })
      .mockResolvedValueOnce({ projectId: 'other' });
    await expect(service.add('org', 'task', 'dependency', 'BLOCKS')).rejects.toMatchObject({
      code: 'TASK_REFERENCE_PROJECT_MISMATCH',
    });
    expect(tx.taskDependency.create).not.toHaveBeenCalled();
  });

  it('rejects self-dependency', async () => {
    const { service, tx } = fixture();
    await expect(service.add('org', 'task', 'task', 'BLOCKS')).rejects.toMatchObject({
      code: 'TASK_DEPENDENCY_CYCLE',
    });
    expect(tx.taskDependency.create).not.toHaveBeenCalled();
  });

  it.each(['BLOCKS', 'RELATES_TO', 'DUPLICATES'] as const)(
    'rejects a cycle for %s beyond 500 nodes',
    async (type) => {
      const { service, tx } = fixture();
      const edges = Array.from({ length: 601 }, (_, i) => ({
        taskId: `node-${i}`,
        dependsOnTaskId: i === 600 ? 'task' : `node-${i + 1}`,
      }));
      tx.taskDependency.findMany.mockResolvedValue(edges);
      await expect(service.add('org', 'task', 'node-0', type)).rejects.toMatchObject({
        code: 'TASK_DEPENDENCY_CYCLE',
      });
      expect(tx.taskDependency.create).not.toHaveBeenCalled();
    },
  );

  it('allows a large acyclic graph and terminates on an unrelated existing cycle', async () => {
    const { service, tx } = fixture();
    tx.taskDependency.findMany.mockResolvedValue([
      ...Array.from({ length: 601 }, (_, i) => ({
        taskId: `node-${i}`,
        dependsOnTaskId: `node-${i + 1}`,
      })),
      { taskId: 'node-602', dependsOnTaskId: 'node-601' },
      { taskId: 'node-601', dependsOnTaskId: 'node-602' },
    ]);
    await service.add('org', 'task', 'node-0', 'BLOCKS');
    expect(tx.taskDependency.create).toHaveBeenCalledOnce();
  });

  it('replays the same edge without another audit, and rejects a different type', async () => {
    const { service, tx, audit } = fixture();
    tx.taskDependency.findUnique.mockResolvedValue({ id: 'existing', type: 'BLOCKS' });
    expect(await service.add('org', 'task', 'dependency', 'BLOCKS')).toEqual({
      id: 'existing',
      type: 'BLOCKS',
    });
    await expect(service.add('org', 'task', 'dependency', 'DUPLICATES')).rejects.toMatchObject({
      code: 'TASK_DEPENDENCY_EXISTS',
    });
    expect(tx.taskDependency.create).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('propagates audit failure to roll back the transaction', async () => {
    const { service, audit } = fixture();
    audit.recordInTransaction.mockRejectedValue(new Error('audit failure'));
    await expect(service.add('org', 'task', 'dependency', 'BLOCKS')).rejects.toThrow(
      'audit failure',
    );
  });
});
