import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { OrgRole, ProjectPhaseStatus, RunStatus, TaskStatus } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectPhasesService } from '../src/modules/projects/project-phases.service';
import { ProjectPhaseLifecycleService } from '../src/modules/projects/project-phase-lifecycle.service';

const databaseUrl = process.env.ENGLOOP_PHASE_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Phase lifecycle PostgreSQL integration', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let db: PrismaService;
  let audit: AuditService;
  let phases: ProjectPhasesService;
  let lifecycle: ProjectPhaseLifecycleService;
  let org: string;
  let project: string;
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    db = prisma as PrismaService;
    audit = new AuditService(db);
    phases = new ProjectPhasesService(db, audit);
    lifecycle = new ProjectPhaseLifecycleService(db, audit);
    org = (
      await prisma.organization.create({ data: { name: 'Lifecycle proof', slug: randomUUID() } })
    ).id;
  });
  beforeEach(async () => {
    project = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Fixture', slug: randomUUID(), key: randomUUID() },
      })
    ).id;
  });
  afterAll(async () => {
    if (org) {
      await prisma.projectPhaseDependency.deleteMany({
        where: { phase: { project: { organizationId: org } } },
      });
      await prisma.organization.delete({ where: { id: org } });
    }
    await prisma.$disconnect();
  });
  const create = (name: string, dependencyIds?: string[]) =>
    phases.create(org, OrgRole.ADMIN, project, { name, dependencyIds });
  const activate = (id: string) => lifecycle.transition(org, OrgRole.ADMIN, project, id, false);
  const reopen = (id: string) => lifecycle.transition(org, OrgRole.ADMIN, project, id, true);

  it('activates only with accepted prerequisites; transitions audit and repeated requests are no-ops', async () => {
    const prerequisite = await create('Prerequisite');
    const phase = await create('Dependent', [prerequisite.id]);
    expect(phase.status).toBe(ProjectPhaseStatus.DRAFT);
    await expect(activate(phase.id)).rejects.toMatchObject({
      code: 'PHASE_PREREQUISITES_NOT_ACCEPTED',
    });
    // CP-06 will own this evidence-gated write; no public acceptance route exists.
    await prisma.projectPhase.update({
      where: { id: prerequisite.id },
      data: { status: ProjectPhaseStatus.ACCEPTED },
    });
    const active = await activate(phase.id);
    expect(active.status).toBe(ProjectPhaseStatus.ACTIVE);
    const audits = await prisma.auditLog.count({ where: { projectId: project } });
    expect(await activate(phase.id)).toEqual(active);
    expect(await prisma.auditLog.count({ where: { projectId: project } })).toBe(audits);
    expect((await reopen(phase.id)).status).toBe(ProjectPhaseStatus.DRAFT);
    await expect(reopen(prerequisite.id)).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
  });

  it.each([ProjectPhaseStatus.ACTIVE, ProjectPhaseStatus.ACCEPTED])(
    'locks metadata, dependencies, deletion and both ends of membership for %s',
    async (status) => {
      const locked = await create('Locked');
      const draft = await create('Draft');
      const task = await prisma.task.create({
        data: { projectId: project, phaseId: locked.id, title: 'Idle', key: 'LC-1' },
      });
      await prisma.projectPhase.update({ where: { id: locked.id }, data: { status } });
      await expect(
        phases.update(org, OrgRole.ADMIN, project, locked.id, { name: 'Changed' }),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      await expect(
        phases.update(org, OrgRole.ADMIN, project, locked.id, { dependencyIds: [draft.id] }),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      await expect(phases.delete(org, OrgRole.ADMIN, project, locked.id)).rejects.toMatchObject({
        code: 'PHASE_LOCKED',
      });
      await expect(
        phases.order(org, OrgRole.ADMIN, project, [draft.id, locked.id]),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      await expect(
        phases.membership(org, OrgRole.ADMIN, project, draft.id, task.id, true),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      await expect(
        phases.membership(org, OrgRole.ADMIN, project, locked.id, task.id, false),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      await expect(
        phases.membership(org, OrgRole.ADMIN, project, locked.id, task.id, true),
      ).resolves.toMatchObject({ phaseId: locked.id });
    },
  );

  it('preserves locked positions and timestamps during draft reorder and rejects deletion that would shift them', async () => {
    const first = await create('First');
    const locked = await create('Locked');
    const third = await create('Third');
    const fourth = await create('Fourth');
    await activate(locked.id);
    const before = await prisma.projectPhase.findUniqueOrThrow({ where: { id: locked.id } });
    await phases.order(org, OrgRole.ADMIN, project, [first.id, locked.id, fourth.id, third.id]);
    expect(await prisma.projectPhase.findUniqueOrThrow({ where: { id: locked.id } })).toEqual(
      before,
    );
    await expect(phases.delete(org, OrgRole.ADMIN, project, first.id)).rejects.toMatchObject({
      code: 'PHASE_LOCKED',
    });
    await phases.delete(org, OrgRole.ADMIN, project, third.id);
  });

  it.each([TaskStatus.QUEUED, TaskStatus.PR_READY])(
    'blocks reopen when linked task is %s',
    async (status) => {
      const phase = await create('Phase');
      await prisma.task.create({
        data: { projectId: project, phaseId: phase.id, title: 'Task', key: 'LC-1', status },
      });
      await activate(phase.id);
      await expect(reopen(phase.id)).rejects.toMatchObject({ code: 'PHASE_REOPEN_BLOCKED' });
    },
  );
  it.each([RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN])(
    'blocks reopen on linked idle task with workflow %s',
    async (status) => {
      const phase = await create('Phase');
      const task = await prisma.task.create({
        data: { projectId: project, phaseId: phase.id, title: 'Task', key: 'LC-1' },
      });
      await prisma.workflowRun.create({
        data: { projectId: project, taskId: task.id, definitionKey: 'engineering', status },
      });
      await activate(phase.id);
      await expect(reopen(phase.id)).rejects.toMatchObject({ code: 'PHASE_REOPEN_BLOCKED' });
    },
  );
  it.each(['PENDING', 'RUNNING'] as const)(
    'blocks reopen on pending/running agent %s',
    async (status) => {
      const phase = await create('Phase');
      const task = await prisma.task.create({
        data: { projectId: project, phaseId: phase.id, title: 'Task', key: 'LC-1' },
      });
      await prisma.agentRun.create({
        data: { taskId: task.id, role: 'IMPLEMENTER', providerKey: 'mock', status },
      });
      await activate(phase.id);
      await expect(reopen(phase.id)).rejects.toMatchObject({ code: 'PHASE_REOPEN_BLOCKED' });
    },
  );
  it('waits for a concurrent task start before checking whether reopen is safe', async () => {
    const phase = await create('Phase');
    const task = await prisma.task.create({
      data: { projectId: project, phaseId: phase.id, title: 'Task', key: 'LC-1' },
    });
    await activate(phase.id);
    let locked!: () => void;
    const taskLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id} FOR UPDATE`;
      locked();
      await released;
      await tx.task.update({ where: { id: task.id }, data: { status: TaskStatus.PLANNING } });
      await tx.workflowRun.create({
        data: { projectId: project, taskId: task.id, definitionKey: 'engineering' },
      });
    });
    await taskLocked;
    const reopening = expect(reopen(phase.id)).rejects.toMatchObject({
      code: 'PHASE_REOPEN_BLOCKED',
    });
    release();
    await start;
    await reopening;
    expect((await phases.findOne(org, project, phase.id)).status).toBe(ProjectPhaseStatus.ACTIVE);
  });
  it('rejects tenant/role escapes and rolls status back on failed audit', async () => {
    const phase = await create('Phase');
    await expect(
      lifecycle.transition('foreign', OrgRole.ADMIN, project, phase.id, false),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      lifecycle.transition(org, OrgRole.MEMBER, project, phase.id, false),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const spy = vi
      .spyOn(audit, 'recordInTransaction')
      .mockRejectedValueOnce(new Error('Audit failed'));
    await expect(activate(phase.id)).rejects.toThrow('Audit failed');
    spy.mockRestore();
    expect((await prisma.projectPhase.findUniqueOrThrow({ where: { id: phase.id } })).status).toBe(
      ProjectPhaseStatus.DRAFT,
    );
  });
  it('serializes activation against metadata and membership edits', async () => {
    const phase = await create('Phase');
    const task = await prisma.task.create({
      data: { projectId: project, title: 'Task', key: 'LC-1' },
    });
    const results = await Promise.allSettled([
      activate(phase.id),
      phases.update(org, OrgRole.ADMIN, project, phase.id, { name: 'Edited' }),
      phases.membership(org, OrgRole.ADMIN, project, phase.id, task.id, true),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    for (const result of results.slice(1))
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'PHASE_LOCKED' });
    expect((await phases.findOne(org, project, phase.id)).status).toBe(ProjectPhaseStatus.ACTIVE);
  });
});
