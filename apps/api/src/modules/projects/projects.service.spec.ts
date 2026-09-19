import { RepositoryProvider } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { AgentRole, OrgRole } from '@engloop/types';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProjectsService } from './projects.service';

describe('ProjectsService repository connection', () => {
  it('requires the verified import flow for GitHub repositories', async () => {
    const create = vi.fn();
    const service = new ProjectsService(
      { repository: { create } } as unknown as PrismaService,
      {} as never,
      {} as never,
    );

    await expect(
      service.addRepository('org-1', 'OWNER', 'project-1', {
        name: 'private',
        provider: RepositoryProvider.GITHUB,
        defaultBranch: 'main',
        frameworks: [],
        packageManager: 'pnpm',
        commands: {},
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_IMPORT_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ProjectsService role assignments', () => {
  it.each([
    {
      name: 'foreign organization',
      agent: {
        id: 'agent-1',
        organizationId: 'org-2',
        projectId: null,
        role: AgentRole.IMPLEMENTER,
        enabled: true,
      },
    },
    {
      name: 'disabled agent',
      agent: {
        id: 'agent-1',
        organizationId: 'org-1',
        projectId: null,
        role: AgentRole.IMPLEMENTER,
        enabled: false,
      },
    },
    {
      name: 'wrong role',
      agent: {
        id: 'agent-1',
        organizationId: 'org-1',
        projectId: null,
        role: AgentRole.CODE_REVIEWER,
        enabled: true,
      },
    },
    {
      name: 'foreign project',
      agent: {
        id: 'agent-1',
        organizationId: 'org-1',
        projectId: 'project-2',
        role: AgentRole.IMPLEMENTER,
        enabled: true,
      },
    },
  ])('rejects a $name assignment before update or audit', async ({ agent }) => {
    const update = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      project: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'project-1',
          organizationId: 'org-1',
          roleAssignments: {},
        }),
        update,
      },
      agent: { findMany: vi.fn().mockResolvedValue([agent]) },
    };
    const service = new ProjectsService(
      prisma as never,
      { publish: vi.fn() } as never,
      { recordSafe } as never,
    );

    await expect(
      service.setRoleAssignments('org-1', OrgRole.OWNER, 'project-1', [
        { role: AgentRole.IMPLEMENTER, agentId: 'agent-1' },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_ROLE_ASSIGNMENT' });
    expect(update).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });
});
