import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GitApiService } from './git.service';

describe('GitApiService tenant scope', () => {
  it('scopes worktrees and task artifacts to the authenticated organization', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue({ id: 'artifact-1' });
    const prisma = {
      gitWorktree: { findMany },
      artifact: { findFirst },
    } as unknown as PrismaService;
    const service = new GitApiService(prisma);

    await service.listWorktrees('org-1', 'repo-1');
    await service.diff('org-1', 'task-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: { project: { organizationId: 'org-1' } },
          repositoryId: 'repo-1',
        },
      }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ task: { project: { organizationId: 'org-1' } } }),
      }),
    );
  });

  it('scopes pull-request pagination through repository project ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      pullRequest: { findMany, count },
      $transaction: vi.fn().mockImplementation(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const service = new GitApiService(prisma);

    await service.listPullRequests('org-1', {
      page: 1,
      pageSize: 25,
      projectId: 'project-1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: { project: { organizationId: 'org-1', id: 'project-1' } },
        },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { repository: { project: { organizationId: 'org-1', id: 'project-1' } } },
    });
  });
});
