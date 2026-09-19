import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorktreeManager } from '../src';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('WorktreeManager authenticated checkout', () => {
  it('does not continue from stale source when an authenticated fetch fails', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'engloop-git-auth-'));
    temporaryPaths.push(workspaceRoot);
    const authentication = { token: 'short-lived-installation-token' };
    const fetch = vi.fn().mockRejectedValue(new Error('access denied'));
    const setRemoteUrl = vi.fn().mockResolvedValue(undefined);
    const manager = new WorktreeManager({
      workspaceRoot,
      git: {
        isRepository: vi.fn().mockResolvedValue(true),
        setRemoteUrl,
        fetch,
      } as never,
    });

    await expect(
      manager.ensureCheckout({
        repositoryId: 'repository-1',
        remoteUrl: 'https://github.com/example/private.git',
        defaultBranch: 'main',
        authentication,
      }),
    ).rejects.toThrow('access denied');
    expect(setRemoteUrl).toHaveBeenCalledWith(
      expect.any(String),
      'https://github.com/example/private.git',
    );
    expect(fetch).toHaveBeenCalledWith(expect.any(String), 'origin', authentication);
  });
});
