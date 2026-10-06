import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { OrgRole, TaskStatus } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectPhasesService } from '../src/modules/projects/project-phases.service';

const databaseUrl = process.env.ENGLOOP_PHASE_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Project phases PostgreSQL integration (isolated explicit DB)',
  () => {
    let prisma: ReturnType<typeof createPrismaClient>;
    let db: PrismaService;
    let service: ProjectPhasesService;
    const marker = randomUUID();
    let org: string;
    let project: string;
    let otherProject: string;
    let foreignOrg: string;
    let foreignProject: string;
    let task: string;
    let foreignTask: string;

    beforeAll(async () => {
      prisma = createPrismaClient({ databaseUrl });
      db = prisma as PrismaService;
      service = new ProjectPhasesService(db, new AuditService(db));
      const organization = await prisma.organization.create({
        data: { name: 'Phase test', slug: `phase-${marker}` },
      });
      org = organization.id;
      foreignOrg = (
        await prisma.organization.create({
          data: { name: 'Foreign phase test', slug: `foreign-phase-${marker}` },
        })
      ).id;
      project = (
        await prisma.project.create({
          data: { organizationId: org, name: 'Phase fixture', slug: 'phase', key: 'PH' },
        })
      ).id;
      otherProject = (
        await prisma.project.create({
          data: { organizationId: org, name: 'Other', slug: 'other', key: 'OT' },
        })
      ).id;
      foreignProject = (
        await prisma.project.create({
          data: { organizationId: foreignOrg, name: 'Foreign', slug: 'foreign', key: 'FR' },
        })
      ).id;
      task = (
        await prisma.task.create({
          data: { projectId: project, key: 'PH-1', title: 'Preserved task' },
        })
      ).id;
      foreignTask = (
        await prisma.task.create({
          data: { projectId: foreignProject, key: 'FR-1', title: 'Foreign task' },
        })
      ).id;
    });
    afterAll(async () => {
      if (org) await prisma.organization.delete({ where: { id: org } });
      if (foreignOrg) await prisma.organization.delete({ where: { id: foreignOrg } });
      await prisma.$disconnect();
    });

    it('creates concurrent phases with unique contiguous order, atomically reorders, and audits', async () => {
      const phases = await Promise.all(
        ['First', 'Second', 'Third'].map((name) =>
          service.create(org, OrgRole.OWNER, project, { name }),
        ),
      );
      expect((await service.list(org, project)).items.map((phase) => phase.position)).toEqual([
        0, 1, 2,
      ]);
      const reversed = phases.map((phase) => phase.id).reverse();
      expect(
        (await service.order(org, OrgRole.ADMIN, project, reversed)).items.map((phase) => phase.id),
      ).toEqual(reversed);
      await expect(
        service.order(org, OrgRole.OWNER, project, [reversed[0]!]),
      ).rejects.toMatchObject({ code: 'INVALID_PHASE_ORDER' });
      expect((await service.list(org, project)).items.map((phase) => phase.id)).toEqual(reversed);
      expect(
        await prisma.auditLog.count({ where: { projectId: project, entityType: 'projectPhase' } }),
      ).toBe(4);
    });

    it('rejects tenant escapes and same-tenant cross-project task membership at API and database layers', async () => {
      const phase = (await service.list(org, project)).items[0]!;
      await expect(service.list(foreignOrg, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.findOne(org, foreignProject, phase.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        service.membership(org, OrgRole.ADMIN, project, phase.id, foreignTask, true),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const other = await prisma.task.create({
        data: { projectId: otherProject, key: 'OT-1', title: 'Other project' },
      });
      await expect(
        service.membership(org, OrgRole.ADMIN, project, phase.id, other.id, true),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        prisma.task.update({ where: { id: other.id }, data: { phaseId: phase.id } }),
      ).rejects.toThrow();
    });

    it('links and moves idle tasks but protects running membership and deletion', async () => {
      const phases = (await service.list(org, project)).items;
      await service.membership(org, OrgRole.ADMIN, project, phases[0]!.id, task, true);
      const auditsBefore = await prisma.auditLog.count({ where: { projectId: project } });
      const updatedBefore = (await prisma.task.findUniqueOrThrow({ where: { id: task } }))
        .updatedAt;
      await service.membership(org, OrgRole.ADMIN, project, phases[0]!.id, task, true);
      expect(await prisma.auditLog.count({ where: { projectId: project } })).toBe(auditsBefore);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task } })).updatedAt).toEqual(
        updatedBefore,
      );
      await service.membership(org, OrgRole.ADMIN, project, phases[1]!.id, task, true);
      await expect(
        service.membership(org, OrgRole.ADMIN, project, phases[0]!.id, task, false),
      ).rejects.toMatchObject({ code: 'TASK_PHASE_MISMATCH' });
      await prisma.task.update({ where: { id: task }, data: { status: TaskStatus.IMPLEMENTING } });
      await expect(
        service.membership(org, OrgRole.ADMIN, project, phases[0]!.id, task, true),
      ).rejects.toMatchObject({ code: 'TASK_PHASE_LOCKED' });
      await expect(
        service.delete(org, OrgRole.ADMIN, project, phases[1]!.id),
      ).rejects.toMatchObject({ code: 'TASK_PHASE_LOCKED' });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task } })).phaseId).toBe(
        phases[1]!.id,
      );
      await prisma.task.update({ where: { id: task }, data: { status: TaskStatus.BACKLOG } });
      await service.delete(org, OrgRole.ADMIN, project, phases[1]!.id);
      const preserved = await prisma.task.findUniqueOrThrow({ where: { id: task } });
      expect(preserved.title).toBe('Preserved task');
      expect(preserved.phaseId).toBeNull();
      const unlinkAuditCount = await prisma.auditLog.count({ where: { projectId: project } });
      await service.membership(org, OrgRole.ADMIN, project, phases[0]!.id, task, false);
      expect(await prisma.auditLog.count({ where: { projectId: project } })).toBe(unlinkAuditCount);
      expect((await service.list(org, project)).items.map((phase) => phase.position)).toEqual([
        0, 1,
      ]);
    });

    it('rolls phase updates back when transactional audit fails', async () => {
      const phase = (await service.list(org, project)).items[0]!;
      const failing = new ProjectPhasesService(db, {
        recordInTransaction: async () => {
          throw new Error('audit unavailable');
        },
      } as unknown as AuditService);
      await expect(
        failing.update(org, OrgRole.OWNER, project, phase.id, { name: 'must rollback' }),
      ).rejects.toThrow('audit unavailable');
      expect((await service.findOne(org, project, phase.id)).name).toBe(phase.name);
      const beforeOrder = (await service.list(org, project)).items.map((item) => item.id);
      await expect(
        failing.order(org, OrgRole.OWNER, project, [...beforeOrder].reverse()),
      ).rejects.toThrow('audit unavailable');
      expect((await service.list(org, project)).items.map((item) => item.id)).toEqual(beforeOrder);
    });
    it('waits for a competing task status update and then rejects membership changes', async () => {
      const phase = (await service.list(org, project)).items[0]!;
      let releaseLock: () => void = () => undefined;
      let announceLock: () => void = () => undefined;
      const locked = new Promise<void>((resolveLock) => {
        announceLock = resolveLock;
      });
      const release = new Promise<void>((resolveRelease) => {
        releaseLock = resolveRelease;
      });
      const competing = prisma.$transaction(
        async (tx) => {
          await tx.task.update({ where: { id: task }, data: { status: TaskStatus.IMPLEMENTING } });
          announceLock();
          await release;
        },
        { timeout: 30_000 },
      );
      await locked;
      const mutation = service.membership(org, OrgRole.ADMIN, project, phase.id, task, true);
      releaseLock();
      await competing;
      await expect(mutation).rejects.toMatchObject({ code: 'TASK_PHASE_LOCKED' });
      await prisma.task.update({ where: { id: task }, data: { status: TaskStatus.BACKLOG } });
    });
    it('protects a backlog task with a pending workflow run', async () => {
      const phase = (await service.list(org, project)).items[0]!;
      const workflow = await prisma.workflowRun.create({
        data: { projectId: project, taskId: task, definitionKey: 'engineering', status: 'PENDING' },
      });
      await expect(
        service.membership(org, OrgRole.ADMIN, project, phase.id, task, true),
      ).rejects.toMatchObject({ code: 'TASK_PHASE_LOCKED' });
      await prisma.workflowRun.delete({ where: { id: workflow.id } });
    });
  },
);
