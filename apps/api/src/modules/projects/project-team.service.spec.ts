import { describe, expect, it, vi } from 'vitest';
import { AgentRole, OrgRole } from '@engloop/types';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ProjectTeamService } from './project-team.service';

function fixture() {
  const project = {
    teamConfigured: true,
    teamVersion: 0,
    teamRequiredRoles: [AgentRole.PLANNER],
    teamMembers: [{ agentId: 'planner' }],
    phases: [{ id: 'phase', name: 'Implementation', requiredRoles: [AgentRole.CODE_REVIEWER] }],
  };
  const agent = {
    id: 'planner',
    name: 'Planner',
    role: AgentRole.PLANNER,
    enabled: true,
    provider: { enabled: true, organizationId: 'org' },
    configurations: [{ id: 'config', version: 2 }],
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'project' }]),
    project: { findFirst: vi.fn().mockResolvedValue(project), update: vi.fn() },
    projectPhase: { findFirst: vi.fn().mockResolvedValue(null) },
    workflowRun: { findFirst: vi.fn().mockResolvedValue(null) },
    agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
    task: { findFirst: vi.fn().mockResolvedValue(null) },
    agent: { findMany: vi.fn().mockResolvedValue([agent]) },
    projectTeamMember: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const audit = { recordInTransaction: vi.fn() };
  const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  const service = new ProjectTeamService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, tx, prisma, audit, project, agent };
}

describe('ProjectTeamService', () => {
  it.each(['MEMBER', 'VIEWER', 'PLANNER', ''])(
    'role %s grants no team management authority',
    async (role) => {
      const { service, prisma } = fixture();
      await expect(
        service.replace('org', role, 'project', {
          expectedVersion: 0,
          memberIds: [],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it('scopes reads and candidate selection to the organization and project', async () => {
    const { service, tx } = fixture();
    const result = await service.read('org', 'project');
    expect(tx.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'project', organizationId: 'org' } }),
    );
    expect(tx.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org', OR: [{ projectId: 'project' }, { projectId: null }] },
      }),
    );
    expect(result.coverage).toEqual({
      requiredRoles: [AgentRole.PLANNER],
      coveredRoles: [AgentRole.PLANNER],
      missingRoles: [],
    });
    expect(result.phases[0]?.missingRoles).toEqual([AgentRole.CODE_REVIEWER]);
    expect(result.agents[0]?.configuration).toEqual({ id: 'config', version: 2 });
    expect(JSON.stringify(result)).not.toMatch(/provider|credential|values|permissionLevel/);
  });
  it('does not implicitly select candidates for an empty team', async () => {
    const { service, project } = fixture();
    project.teamMembers = [];
    expect((await service.read('org', 'project')).coverage.missingRoles).toEqual([
      AgentRole.PLANNER,
    ]);
  });
  it.each(['agent', 'provider'])(
    'disabled %s does not cover a role or permit selection',
    async (kind) => {
      const { service, agent, tx } = fixture();
      if (kind === 'agent') agent.enabled = false;
      else agent.provider.enabled = false;
      expect((await service.read('org', 'project')).coverage.missingRoles).toEqual([
        AgentRole.PLANNER,
      ]);
      await expect(
        service.replace('org', OrgRole.OWNER, 'project', {
          expectedVersion: 0,
          memberIds: ['planner'],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(tx.projectTeamMember.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('rejects foreign or other-project agents without replacing membership', async () => {
    const { service, tx } = fixture();
    await expect(
      service.replace('org', OrgRole.ADMIN, 'project', {
        expectedVersion: 0,
        memberIds: ['foreign-agent'],
        requiredRoles: [],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.projectTeamMember.deleteMany).not.toHaveBeenCalled();
  });
  it.each(['projectPhase', 'workflowRun', 'agentRun', 'task'] as const)(
    'locks edits when %s is live',
    async (model) => {
      const { service, tx } = fixture();
      tx[model].findFirst.mockResolvedValue({ id: 'live' });
      await expect(
        service.replace('org', OrgRole.ADMIN, 'project', {
          expectedVersion: 0,
          memberIds: [],
          requiredRoles: [],
        }),
      ).rejects.toMatchObject({ code: 'PHASE_LOCKED' });
      expect(tx.projectTeamMember.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('clears members and requirements in the same audited transaction', async () => {
    const { service, tx, audit } = fixture();
    await service.replace('org', OrgRole.ADMIN, 'project', {
      expectedVersion: 0,
      memberIds: [],
      requiredRoles: [],
    });
    expect(tx.projectTeamMember.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'project' },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project' },
      data: { teamRequiredRoles: [], teamConfigured: true, teamVersion: { increment: 1 } },
    });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: 'projectTeam', action: 'CONFIGURATION_CHANGED' }),
    );
  });
  it('avoids writes and audit for unchanged membership and requirements', async () => {
    const { service, tx, audit } = fixture();
    await service.replace('org', OrgRole.OWNER, 'project', {
      expectedVersion: 0,
      memberIds: ['planner'],
      requiredRoles: [AgentRole.PLANNER],
    });
    expect(tx.projectTeamMember.deleteMany).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });
});
