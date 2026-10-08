import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole, AgentProviderKind, OrgRole } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectTeamService } from '../src/modules/projects/project-team.service';
import { AgentsService } from '../src/modules/agents/agents.service';

const databaseUrl = process.env.ENGLOOP_TEAM_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Project team PostgreSQL integration', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let teams: ProjectTeamService;
  let org: string;
  let foreignOrg: string;
  let project: string;
  let otherProject: string;
  let provider: string;
  let member: string;
  let second: string;
  let foreign: string;
  let other: string;
  let disabled: string;
  let invalidProvider: string;
  let phase: string;

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    const db = prisma as PrismaService;
    teams = new ProjectTeamService(db, new AuditService(db));
    org = (
      await prisma.organization.create({
        data: { name: 'Team proof', slug: `team-${randomUUID()}` },
      })
    ).id;
    foreignOrg = (
      await prisma.organization.create({
        data: { name: 'Foreign proof', slug: `foreign-team-${randomUUID()}` },
      })
    ).id;
    project = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Team', slug: 'team', key: 'TEAM' },
      })
    ).id;
    otherProject = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Other', slug: 'other', key: 'OTHER' },
      })
    ).id;
    provider = (
      await prisma.agentProvider.create({
        data: {
          organizationId: org,
          key: 'mock',
          displayName: 'Mock',
          kind: AgentProviderKind.MOCK,
          encryptedCredential: 'must-never-leak',
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
          displayName: 'Foreign',
          kind: AgentProviderKind.MOCK,
        },
      })
    ).id;
    const make = async (
      name: string,
      overrides: {
        organizationId?: string;
        providerId?: string;
        projectId?: string;
        enabled?: boolean;
      } = {},
    ) =>
      (
        await prisma.agent.create({
          data: {
            organizationId: org,
            providerId: provider,
            name,
            role: AgentRole.IMPLEMENTER,
            ...overrides,
          },
        })
      ).id;
    member = await make('Org implementer');
    second = await make('Project implementer', { projectId: project });
    foreign = await make('Foreign implementer', {
      organizationId: foreignOrg,
      providerId: foreignProvider,
    });
    other = await make('Other project implementer', { projectId: otherProject });
    disabled = await make('Disabled implementer', { enabled: false });
    invalidProvider = await make('Invalid provider implementer', { providerId: foreignProvider });
    phase = (
      await prisma.projectPhase.create({
        data: {
          projectId: project,
          name: 'Draft',
          position: 0,
          requiredRoles: [AgentRole.IMPLEMENTER, AgentRole.PLANNER],
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (org) await prisma.organization.delete({ where: { id: org } });
    if (foreignOrg) await prisma.organization.delete({ where: { id: foreignOrg } });
    await prisma?.$disconnect();
  });

  it('retains opt-in defaults and isolates project and phase reads and all writes', async () => {
    expect(await teams.read(org, project)).toMatchObject({
      configured: false,
      version: 0,
      members: [],
    });
    await expect(teams.read(foreignOrg, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(teams.roleCoverage(org, otherProject, phase)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(teams.roleCoverage(foreignOrg, project, phase)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      teams.replace(org, OrgRole.MEMBER, project, { expectedVersion: 0, agentIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      teams.replace(foreignOrg, OrgRole.OWNER, project, { expectedVersion: 0, agentIds: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const id of [foreign, other, disabled, invalidProvider, 'missing-agent'])
      await expect(
        teams.replace(org, OrgRole.ADMIN, project, { expectedVersion: 0, agentIds: [id] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.projectTeamMember.count({ where: { projectId: project } })).toBe(0);
  });

  it('supports multiple same-role members, safe summaries, coverage and idempotent replacements', async () => {
    const result = await teams.replace(org, OrgRole.OWNER, project, {
      expectedVersion: 0,
      agentIds: [member, second],
    });
    expect(result).toMatchObject({ configured: true, version: 1 });
    expect(result.members).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('must-never-leak');
    expect(JSON.stringify(result)).not.toContain('credentialIv');
    const coverage = await teams.roleCoverage(org, project, phase);
    expect(coverage.missingRoles).toEqual([AgentRole.PLANNER]);
    expect(
      coverage.coverage.find(({ role }) => role === AgentRole.IMPLEMENTER)?.agentIds,
    ).toHaveLength(2);
    const count = await prisma.auditLog.count({
      where: { projectId: project, entityType: 'projectTeam' },
    });
    expect(
      (
        await teams.replace(org, OrgRole.ADMIN, project, {
          expectedVersion: 1,
          agentIds: [second, member],
        })
      ).version,
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { projectId: project, entityType: 'projectTeam' } }),
    ).toBe(count);
    await expect(
      teams.replace(org, OrgRole.ADMIN, project, { expectedVersion: 0, agentIds: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('derives eligibility after disabling a provider and hides malformed foreign membership metadata', async () => {
    await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: false } });
    expect((await teams.roleCoverage(org, project, phase)).missingRoles).toEqual([
      AgentRole.PLANNER,
      AgentRole.IMPLEMENTER,
    ]);
    const legacy = new AgentsService(
      prisma as PrismaService,
      new AuditService(prisma as PrismaService),
    );
    expect((await legacy.team(org, project)).meta.totalAgents).toBe(0);
    await expect(legacy.team(foreignOrg, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: true } });
    await prisma.projectTeamMember.create({ data: { projectId: project, agentId: foreign } });
    expect((await teams.read(org, project)).members.map(({ id }) => id)).not.toContain(foreign);
    await prisma.projectTeamMember.delete({
      where: { projectId_agentId: { projectId: project, agentId: foreign } },
    });
  });

  it('serializes competing expected-version replacements and keeps an explicit empty roster', async () => {
    const outcomes = await Promise.allSettled([
      teams.replace(org, OrgRole.OWNER, project, { expectedVersion: 1, agentIds: [member] }),
      teams.replace(org, OrgRole.ADMIN, project, { expectedVersion: 1, agentIds: [second] }),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(
      await teams.replace(org, OrgRole.ADMIN, project, { expectedVersion: 2, agentIds: [] }),
    ).toMatchObject({ configured: true, version: 3, members: [] });
  });

  it('rolls roster, configured state, version and audit back together on audit failure', async () => {
    const before = await teams.read(org, project);
    const audit = new AuditService(prisma as PrismaService);
    const failure = vi
      .spyOn(audit, 'recordInTransaction')
      .mockRejectedValue(new Error('audit failure'));
    const failing = new ProjectTeamService(prisma as PrismaService, audit);
    await expect(
      failing.replace(org, OrgRole.OWNER, project, { expectedVersion: 3, agentIds: [member] }),
    ).rejects.toThrow('audit failure');
    failure.mockRestore();
    expect(await teams.read(org, project)).toEqual(before);
    expect(
      await prisma.auditLog.count({ where: { projectId: project, entityType: 'projectTeam' } }),
    ).toBe(3);
  });
});
