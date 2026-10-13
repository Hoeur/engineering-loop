import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole, AgentProviderKind } from '@engloop/types';
import { ContextBuilder } from './context-builder';

const databaseUrl = process.env.ENGLOOP_TEAM_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Worker explicit team PostgreSQL selection', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let builder: ContextBuilder;
  let org: string;
  let project: string;
  let provider: string;
  let first: string;
  let second: string;
  let outsider: string;

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    builder = new ContextBuilder(prisma, { AGENT_DEFAULT_PROVIDER: 'mock' } as never);
    org = (
      await prisma.organization.create({
        data: {
          name: 'Worker team',
          slug: `worker-team-${randomUUID()}`,
          defaultProviderKey: 'mock',
        },
      })
    ).id;
    project = (
      await prisma.project.create({
        data: {
          organizationId: org,
          name: 'Worker team',
          slug: 'team',
          key: 'TEAM',
          teamConfigured: true,
        },
      })
    ).id;
    provider = (
      await prisma.agentProvider.create({
        data: {
          organizationId: org,
          key: 'mock',
          displayName: 'Mock',
          kind: AgentProviderKind.MOCK,
        },
      })
    ).id;
    const create = async (name: string) =>
      (
        await prisma.agent.create({
          data: {
            organizationId: org,
            projectId: project,
            providerId: provider,
            role: AgentRole.IMPLEMENTER,
            name,
          },
        })
      ).id;
    first = await create('Z first');
    second = await create('A second');
    outsider = await create('Outside');
    [first, second] = [first, second].sort();
    await prisma.projectTeamMember.createMany({
      data: [first, second].map((agentId) => ({ projectId: project, agentId })),
    });
  });
  afterAll(async () => {
    if (org) await prisma.organization.delete({ where: { id: org } });
    await prisma?.$disconnect();
  });

  it('ignores outside preferred assignment, chooses deterministically and honors an eligible member preference', async () => {
    await prisma.project.update({
      where: { id: project },
      data: { roleAssignments: { IMPLEMENTER: outsider } },
    });
    for (let i = 0; i < 3; i++)
      expect((await builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).agentId).toBe(
        first,
      );
    await prisma.project.update({
      where: { id: project },
      data: { roleAssignments: { IMPLEMENTER: second } },
    });
    expect((await builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).agentId).toBe(
      second,
    );
    await prisma.agent.update({ where: { id: second }, data: { enabled: false } });
    expect((await builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).agentId).toBe(first);
  });

  it('fails closed with disabled providers, uncovered roles and an explicitly empty roster', async () => {
    await expect(builder.resolveRoleProvider(project, AgentRole.PLANNER)).rejects.toThrow(
      'PROJECT_TEAM_ROLE_UNCOVERED',
    );
    await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: false } });
    await expect(builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).rejects.toThrow(
      'PROJECT_TEAM_ROLE_UNCOVERED',
    );
    await prisma.agentProvider.update({ where: { id: provider }, data: { enabled: true } });
    await prisma.projectTeamMember.deleteMany({ where: { projectId: project } });
    await expect(builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).rejects.toThrow(
      'PROJECT_TEAM_ROLE_UNCOVERED',
    );
    await prisma.project.update({ where: { id: project }, data: { teamConfigured: false } });
    expect(
      (await builder.resolveRoleProvider(project, AgentRole.IMPLEMENTER)).agentId,
    ).not.toBeNull();
  });
});
