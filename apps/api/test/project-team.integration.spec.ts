import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole, OrgRole, PermissionLevel, ProjectPhaseStatus } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectTeamService } from '../src/modules/projects/project-team.service';

const databaseUrl = process.env.ENGLOOP_TEAM_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Project team PostgreSQL integration on an explicit scratch DB',
  () => {
    let prisma: ReturnType<typeof createPrismaClient>;
    let service: ProjectTeamService;
    let org: string;
    let foreignOrg: string;
    let project: string;
    let otherProject: string;
    let planner: string;
    let reviewer: string;
    let foreignAgent: string;
    let otherAgent: string;
    let provider: string;
    let phase: string;
    const marker = randomUUID();
    beforeAll(async () => {
      prisma = createPrismaClient({ databaseUrl });
      service = new ProjectTeamService(
        prisma as PrismaService,
        new AuditService(prisma as PrismaService),
      );
      org = (
        await prisma.organization.create({ data: { name: 'Team tests', slug: `team-${marker}` } })
      ).id;
      foreignOrg = (
        await prisma.organization.create({ data: { name: 'Foreign', slug: `foreign-${marker}` } })
      ).id;
      project = (
        await prisma.project.create({
          data: { organizationId: org, name: 'Team', slug: 'team', key: 'TM' },
        })
      ).id;
      otherProject = (
        await prisma.project.create({
          data: { organizationId: org, name: 'Other', slug: 'other', key: 'OT' },
        })
      ).id;
      provider = (
        await prisma.agentProvider.create({
          data: {
            organizationId: org,
            key: 'mock',
            displayName: 'Mock',
            kind: 'MOCK',
            encryptedCredential: 'encrypted-secret',
            credentialIv: 'iv',
            credentialAuthTag: 'tag',
          },
        })
      ).id;
      const foreignProvider = (
        await prisma.agentProvider.create({
          data: {
            organizationId: foreignOrg,
            key: 'mock',
            displayName: 'Foreign mock',
            kind: 'MOCK',
          },
        })
      ).id;
      planner = (
        await prisma.agent.create({
          data: {
            organizationId: org,
            providerId: provider,
            name: 'Planner',
            role: AgentRole.PLANNER,
            permissionLevel: PermissionLevel.LEVEL_1_PLAN,
            configurations: { create: { version: 1, values: { privateContext: 'must-not-leak' } } },
          },
        })
      ).id;
      reviewer = (
        await prisma.agent.create({
          data: {
            organizationId: org,
            projectId: project,
            providerId: provider,
            name: 'Reviewer',
            role: AgentRole.CODE_REVIEWER,
          },
        })
      ).id;
      otherAgent = (
        await prisma.agent.create({
          data: {
            organizationId: org,
            projectId: otherProject,
            providerId: provider,
            name: 'Other',
            role: AgentRole.QA,
          },
        })
      ).id;
      foreignAgent = (
        await prisma.agent.create({
          data: {
            organizationId: foreignOrg,
            providerId: foreignProvider,
            name: 'Foreign',
            role: AgentRole.QA,
          },
        })
      ).id;
      phase = (
        await prisma.projectPhase.create({
          data: {
            projectId: project,
            name: 'Build',
            position: 0,
            requiredRoles: [AgentRole.PLANNER, AgentRole.CODE_REVIEWER],
          },
        })
      ).id;
    });
    afterAll(async () => {
      if (org) await prisma.organization.delete({ where: { id: org } });
      if (foreignOrg) await prisma.organization.delete({ where: { id: foreignOrg } });
      await prisma.$disconnect();
    });
    it('defaults to explicit empty membership and preserves legacy role assignments', async () => {
      await prisma.project.update({
        where: { id: project },
        data: { roleAssignments: { PLANNER: 'mock' } },
      });
      const view = await service.read(org, project);
      expect(view.memberIds).toEqual([]);
      expect(view.phases[0]?.missingRoles).toEqual([AgentRole.PLANNER, AgentRole.CODE_REVIEWER]);
      expect(view.agents.map((agent) => agent.id)).toEqual(
        expect.arrayContaining([planner, reviewer]),
      );
      expect(view.agents.map((agent) => agent.id)).not.toContain(otherAgent);
    });
    it('reuses agent configuration versions, covers roles explicitly and never expands permissions or leaks secrets', async () => {
      const before = await prisma.agent.findUnique({
        where: { id: planner },
        include: { configurations: true },
      });
      const view = await service.replace(org, OrgRole.ADMIN, project, {
        expectedVersion: (await service.read(org, project)).version,
        memberIds: [planner, reviewer],
        requiredRoles: [AgentRole.PLANNER],
      });
      expect(view.coverage.missingRoles).toEqual([]);
      expect(view.phases[0]?.missingRoles).toEqual([]);
      expect(view.agents.find((agent) => agent.id === planner)?.configuration?.version).toBe(1);
      expect(JSON.stringify(view)).not.toMatch(
        /encrypted-secret|credentialIv|credentialAuthTag|must-not-leak|permissionLevel/,
      );
      expect(
        await prisma.agent.findUnique({
          where: { id: planner },
          include: { configurations: true },
        }),
      ).toEqual(before);
      expect(
        (await prisma.project.findUnique({ where: { id: project } }))?.roleAssignments,
      ).toEqual({ PLANNER: 'mock' });
      expect(
        await prisma.auditLog.count({ where: { projectId: project, entityType: 'projectTeam' } }),
      ).toBe(1);
    });
    it('rejects foreign projects, foreign agents, other-project agents and non-admin writes', async () => {
      await expect(service.read(foreignOrg, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.replace(foreignOrg, OrgRole.OWNER, project, {
          expectedVersion: (await service.read(org, project)).version,
          memberIds: [],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      for (const id of [foreignAgent, otherAgent])
        await expect(
          service.replace(org, OrgRole.OWNER, project, {
            expectedVersion: (await service.read(org, project)).version,
            memberIds: [id],
            requiredRoles: [],
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.replace(org, OrgRole.MEMBER, project, {
          expectedVersion: (await service.read(org, project)).version,
          memberIds: [],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await service.read(org, project)).memberIds).toHaveLength(2);
    });
    it('counts disabled agents and providers as uncovered and rejects selecting them', async () => {
      await prisma.agent.update({ where: { id: planner }, data: { enabled: false } });
      expect((await service.read(org, project)).coverage.missingRoles).toEqual([AgentRole.PLANNER]);
      await expect(
        service.replace(org, OrgRole.OWNER, project, {
          expectedVersion: (await service.read(org, project)).version,
          memberIds: [planner],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await prisma.agent.update({ where: { id: planner }, data: { enabled: true } });
      await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: false } });
      await expect(
        service.replace(org, OrgRole.OWNER, project, {
          expectedVersion: (await service.read(org, project)).version,
          memberIds: [reviewer],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: true } });
    });
    it('rolls back membership and required roles if audit persistence fails', async () => {
      const audit = new AuditService(prisma as PrismaService);
      vi.spyOn(audit, 'recordInTransaction').mockRejectedValueOnce(new Error('audit unavailable'));
      const failing = new ProjectTeamService(prisma as PrismaService, audit);
      await expect(
        failing.replace(org, OrgRole.OWNER, project, {
          expectedVersion: (await service.read(org, project)).version,
          memberIds: [],
          requiredRoles: [],
        }),
      ).rejects.toThrow('audit unavailable');
      expect((await service.read(org, project)).memberIds).toHaveLength(2);
      expect((await service.read(org, project)).coverage.requiredRoles).toEqual([
        AgentRole.PLANNER,
      ]);
    });
    it('rechecks phase status after waiting for a competing project writer', async () => {
      let release: () => void = () => undefined;
      let locked: () => void = () => undefined;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const writer = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project} FOR UPDATE`;
          locked();
          await blocker;
          await tx.projectPhase.update({
            where: { id: phase },
            data: { status: ProjectPhaseStatus.ACTIVE },
          });
        },
        { timeout: 30_000 },
      );
      await ready;
      const replacement = service.replace(org, OrgRole.OWNER, project, {
        expectedVersion: (await service.read(org, project)).version,
        memberIds: [],
        requiredRoles: [],
      });
      release();
      await writer;
      await expect(replacement).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      expect((await service.read(org, project)).editable).toBe(false);
      await prisma.projectPhase.update({
        where: { id: phase },
        data: { status: ProjectPhaseStatus.DRAFT },
      });
    });
    it('serializes competing team replacements without mixing memberships and roles', async () => {
      const expectedVersion = (await service.read(org, project)).version;
      const replacements = await Promise.allSettled([
        service.replace(org, OrgRole.OWNER, project, {
          expectedVersion,
          memberIds: [planner],
          requiredRoles: [AgentRole.PLANNER],
        }),
        service.replace(org, OrgRole.ADMIN, project, {
          expectedVersion,
          memberIds: [reviewer],
          requiredRoles: [AgentRole.CODE_REVIEWER],
        }),
      ]);
      expect(replacements.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(replacements.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'CONFLICT' },
      });
      const view = await service.read(org, project);
      expect(view.memberIds).toHaveLength(1);
      expect(view.coverage.missingRoles).toEqual([]);
      expect(view.coverage.requiredRoles).toEqual([
        view.agents.find((agent) => agent.id === view.memberIds[0])?.role,
      ]);
    });
  },
);
