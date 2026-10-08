import { describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@engloop/db';
import { plannerOutputSchema, type PlannerOutput } from '@engloop/schemas';
import { PlanMaterializer } from './plan-materializer';

const validPlan = () =>
  plannerOutputSchema.parse({
    summary: 'Deliver bounded tasks',
    approach: 'Foundation before feature',
    tasks: [
      { title: 'Feature', objective: 'Build the feature', dependsOn: [1] },
      { title: 'Foundation', objective: 'Build its foundation', dependsOn: [] },
      { title: 'Verify', objective: 'Verify the feature', dependsOn: [0, 1] },
    ],
  });

const fixture = () => {
  let sequence = 0;
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'project' }]),
    project: {
      update: vi.fn(async () => ({ key: 'ENG', taskSequence: ++sequence })),
    },
    task: {
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: `child-${sequence}` })),
    },
    taskDependency: { createMany: vi.fn(async () => ({ count: 3 })) },
  };
  const prisma = {
    task: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'parent',
        projectId: 'project',
        repositoryId: null,
        epicId: null,
        featureId: null,
        createdById: null,
        maxAttempts: 3,
      })),
    },
    $transaction: vi.fn(async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      operation(tx as unknown as Prisma.TransactionClient),
    ),
  };
  return { tx, prisma, materializer: new PlanMaterializer(prisma as unknown as PrismaClient) };
};

describe('PlanMaterializer dependency validation', () => {
  it.each(['self', 'foreign', 'duplicate', 'cycle'])(
    'rejects a typed %s plan before any database IO',
    async (kind) => {
      const state = fixture();
      const plan: PlannerOutput = validPlan();
      if (kind === 'self') plan.tasks[0]!.dependsOn = [0];
      if (kind === 'foreign') plan.tasks[0]!.dependsOn = [9];
      if (kind === 'duplicate') plan.tasks[0]!.dependsOn = [1, 1];
      if (kind === 'cycle') plan.tasks[1]!.dependsOn = [0];
      await expect(state.materializer.materialize('parent', plan)).rejects.toThrow();
      expect(state.prisma.task.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(state.prisma.$transaction).not.toHaveBeenCalled();
      expect(state.tx.task.create).not.toHaveBeenCalled();
    },
  );

  it('persists every valid forward and backward dependency in the task transaction', async () => {
    const state = fixture();
    const result = await state.materializer.materialize('parent', validPlan());
    expect(result).toEqual({ createdTaskIds: ['child-1', 'child-2', 'child-3'] });
    expect(state.tx.taskDependency.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 'child-1', dependsOnTaskId: 'child-2' },
        { taskId: 'child-3', dependsOnTaskId: 'child-1' },
        { taskId: 'child-3', dependsOnTaskId: 'child-2' },
      ],
    });
    expect(state.prisma.$transaction).toHaveBeenCalledOnce();
    expect(state.tx.task.create).toHaveBeenCalledTimes(3);
    expect(state.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(state.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      state.tx.task.update.mock.invocationCallOrder[0],
    );
  });
});
