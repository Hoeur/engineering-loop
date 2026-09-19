import { RepositoryProvider } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RepositoriesService } from './repositories.service';

describe('RepositoriesService GitHub canonical fields', () => {
  it('rejects generic mutation of GitHub-synchronized identity fields', async () => {
    const update = vi.fn();
    const prisma = {
      repository: {
        findFirst: vi.fn().mockResolvedValue({ id: 'repository-1', provider: RepositoryProvider.GITHUB }),
        update,
      },
    } as unknown as PrismaService;
    const service = new RepositoriesService(prisma, {} as never);

    await expect(
      service.update('org-1', 'OWNER', 'repository-1', { defaultBranch: 'develop' }),
    ).rejects.toMatchObject({ code: 'GITHUB_CANONICAL_FIELDS_READ_ONLY' });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects stored credentials for GitHub App repositories', async () => {
    const create = vi.fn();
    const prisma = {
      repository: {
        findFirst: vi.fn().mockResolvedValue({ id: 'repository-1', provider: RepositoryProvider.GITHUB }),
      },
      repositoryCredential: { create },
    } as unknown as PrismaService;
    const service = new RepositoriesService(prisma, { encrypt: vi.fn() } as never);

    await expect(
      service.addCredential('org-1', 'OWNER', 'repository-1', 'token', 'PAT', 'secret'),
    ).rejects.toMatchObject({ code: 'GITHUB_APP_CREDENTIALS_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
});
