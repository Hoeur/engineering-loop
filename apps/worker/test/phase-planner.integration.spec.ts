import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole, ProjectPhaseStatus, TaskStatus } from '@engloop/types';
import { plannerOutputSchema, type PlannerOutput } from '@engloop/schemas';
import { PlanMaterializer } from '../src/services/plan-materializer';

const databaseUrl = process.env.ENGLOOP_PHASE_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('Phase planner PostgreSQL integration', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let materializer: PlanMaterializer;
  let organizationId: string;
  let projectId: string;
  let parentId: string;
  let phaseId: string;
  let phaseUpdatedAt: string;

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    materializer = new PlanMaterializer(prisma);
    organizationId = (
      await prisma.organization.create({
        data: { name: 'Phase planner proof', slug: randomUUID() },
      })
    ).id;
  });
  beforeEach(async () => {
    projectId = (
      await prisma.project.create({
        data: { organizationId, name: 'Bounded planner', slug: randomUUID(), key: randomUUID() },
      })
    ).id;
    const phase = await prisma.projectPhase.create({
      data: { projectId, name: 'API increment', position: 0, status: ProjectPhaseStatus.ACTIVE },
    });
    phaseId = phase.id;
    phaseUpdatedAt = phase.updatedAt.toISOString();
    parentId = (
      await prisma.task.create({
        data: { projectId, phaseId, key: 'PARENT', title: 'Plan one increment' },
      })
    ).id;
  });
  afterAll(async () => {
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  const plan = (): PlannerOutput =>
    plannerOutputSchema.parse({
      summary: 'One API increment',
      approach: 'Implement then verify',
      phaseScope: { phaseId, phaseUpdatedAt },
      tasks: [
        {
          title: 'Add validated endpoint',
          objective: 'Expose the phase endpoint',
          ownerRole: AgentRole.BACKEND_DEVELOPER,
          suggestedFiles: ['apps/api/src/modules/projects'],
          acceptanceCriteria: ['Invalid input returns a validation error'],
          requiredChecks: ['UNIT'],
          dependsOn: [],
        },
        {
          title: 'Verify endpoint',
          objective: 'Prove the response contract',
          ownerRole: AgentRole.QA,
          suggestedFiles: ['apps/api/test'],
          acceptanceCriteria: ['Scoped integration checks pass'],
          requiredChecks: ['UNIT'],
          dependsOn: [0],
        },
      ],
    });

  const untouched = async () => {
    expect(await prisma.task.count({ where: { projectId } })).toBe(1);
    expect(await prisma.taskDependency.count({ where: { task: { projectId } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { projectId } })).toBe(0);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({
      taskSequence: 100,
    });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: parentId } })).toMatchObject({
      plan: null,
      planSummary: null,
    });
  };

  it('persists scoped BACKLOG children, roles, criteria, checks and DAG edges atomically', async () => {
    const output = plan();
    const result = await materializer.materialize(parentId, output);
    const children = await prisma.task.findMany({
      where: { parentTaskId: parentId },
      orderBy: { key: 'asc' },
    });
    expect(children.map((task) => task.id)).toEqual(result.createdTaskIds);
    expect(children).toHaveLength(2);
    for (const [index, child] of children.entries()) {
      expect(child).toMatchObject({
        phaseId,
        projectId,
        status: TaskStatus.BACKLOG,
        ownerRole: output.tasks[index]!.ownerRole,
        objective: output.tasks[index]!.objective,
        requiredChecks: ['UNIT'],
        acceptanceCriteria: output.tasks[index]!.acceptanceCriteria,
        assignedAgentId: null,
      });
    }
    expect(
      await prisma.taskDependency.findMany({ where: { taskId: children[1]!.id } }),
    ).toMatchObject([{ taskId: children[1]!.id, dependsOnTaskId: children[0]!.id }]);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: parentId } })).toMatchObject({
      plan: output,
    });
    expect(await prisma.auditLog.count({ where: { projectId } })).toBeGreaterThan(0);
    expect(await prisma.workflowRun.count({ where: { projectId } })).toBe(0);
  });

  it.each([ProjectPhaseStatus.DRAFT, ProjectPhaseStatus.ACCEPTED])(
    'rejects a %s phase without writes',
    async (status) => {
      const output = plan();
      await prisma.projectPhase.update({ where: { id: phaseId }, data: { status } });
      await expect(materializer.materialize(parentId, output)).rejects.toThrow();
      await untouched();
    },
  );

  it('rejects a reopened and edited phase even when it has become ACTIVE again', async () => {
    const output = plan();
    await prisma.projectPhase.update({
      where: { id: phaseId },
      data: { objective: 'Changed contract', updatedAt: new Date(Date.now() + 10_000) },
    });
    await expect(materializer.materialize(parentId, output)).rejects.toThrow();
    await untouched();
  });

  it('rejects a parent that moved to another phase after planning', async () => {
    const output = plan();
    const other = await prisma.projectPhase.create({
      data: { projectId, name: 'Other phase', position: 1, status: ProjectPhaseStatus.ACTIVE },
    });
    await prisma.task.update({ where: { id: parentId }, data: { phaseId: other.id } });
    await expect(materializer.materialize(parentId, output)).rejects.toThrow();
    await untouched();
  });

  it('rejects a phase binding from a different tenant', async () => {
    const foreignOrg = await prisma.organization.create({
      data: { name: 'Foreign planner', slug: randomUUID() },
    });
    try {
      const foreignProject = await prisma.project.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign',
          slug: randomUUID(),
          key: randomUUID(),
        },
      });
      const foreignPhase = await prisma.projectPhase.create({
        data: {
          projectId: foreignProject.id,
          name: 'Foreign',
          position: 0,
          status: ProjectPhaseStatus.ACTIVE,
        },
      });
      const output = plan();
      output.phaseScope = {
        phaseId: foreignPhase.id,
        phaseUpdatedAt: foreignPhase.updatedAt.toISOString(),
      };
      await expect(materializer.materialize(parentId, output)).rejects.toThrow();
      await untouched();
    } finally {
      await prisma.organization.delete({ where: { id: foreignOrg.id } });
    }
  });

  it('rechecks phase state after waiting for a competing project writer', async () => {
    const output = plan();
    let unlock: () => void = () => undefined;
    let locked: () => void = () => undefined;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR NO KEY UPDATE`;
      await tx.projectPhase.update({
        where: { id: phaseId },
        data: { status: ProjectPhaseStatus.DRAFT },
      });
      locked();
      await released;
    });
    await acquired;
    const materialization = materializer.materialize(parentId, output);
    unlock();
    await writer;
    await expect(materialization).rejects.toThrow();
    await untouched();
  });

  it('rolls back children, edges, sequence and parent plan when auditing fails', async () => {
    const trigger = `planner_audit_${randomUUID().replaceAll('-', '')}`;
    // The generated identifiers and Prisma-generated project ID contain no SQL syntax.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated planner audit failure'; END; $$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW."projectId" = '${projectId}') EXECUTE FUNCTION ${trigger}()`,
      );
      await expect(materializer.materialize(parentId, plan())).rejects.toThrow();
      await untouched();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
    }
  });

  it('retains legacy unphased planning without scoped fields or owner role', async () => {
    await prisma.task.update({ where: { id: parentId }, data: { phaseId: null } });
    const output = plannerOutputSchema.parse({
      summary: 'Legacy',
      approach: 'One increment',
      tasks: [{ title: 'Legacy child', objective: 'Deliver the legacy task' }],
    });
    const result = await materializer.materialize(parentId, output);
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: result.createdTaskIds[0]! } }),
    ).toMatchObject({ phaseId: null, ownerRole: null, status: TaskStatus.BACKLOG });
  });
});
