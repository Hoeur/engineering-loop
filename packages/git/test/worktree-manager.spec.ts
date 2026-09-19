import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBranchName, sameFilesystemPath, WorktreeManager } from '../src';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const setup = async (worktrees: { path: string; branch: string | null }[] = []) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'engloop-worktrees-'));
  temporaryPaths.push(workspaceRoot);
  const calls: string[] = [];
  const git = {
    listWorktrees: vi.fn(async () => worktrees),
    removeWorktree: vi.fn(async () => {
      calls.push('remove');
    }),
    addWorktree: vi.fn(async () => {
      calls.push('add');
    }),
  };
  const manager = new WorktreeManager({ workspaceRoot, git: git as never });
  return { manager, git, calls, worktreesDir: manager.layout.worktrees };
};

const acquireInput = (checkoutPath: string, reuse = false) => ({
  repositoryId: 'repository-1',
  taskKey: 'ENG-7',
  taskTitle: 'Retry me',
  baseBranch: 'main',
  checkoutPath,
  reuse,
});

describe('WorktreeManager.acquire', () => {
  it('clears a stale registration through git before adding the worktree again', async () => {
    // After a failed attempt the folder is gone but git still lists nothing matching,
    // or lists it in another spelling. `worktree add` then refuses unless pruned first.
    const { manager, git, calls } = await setup();

    await manager.acquire(acquireInput('/repo'));

    expect(calls).toEqual(['remove', 'add']);
    expect(git.removeWorktree).toHaveBeenCalledWith(
      '/repo',
      join(manager.layout.worktrees, 'ENG-7'),
    );
  });

  it('reuses a worktree that git reports with a different spelling of the same path', async () => {
    const branch = buildBranchName('ENG-7', 'Retry me');
    const { manager, git } = await setup();
    await mkdir(join(manager.layout.worktrees, 'ENG-7'), { recursive: true });
    const reported = `${join(manager.layout.worktrees, 'ENG-7')}/`;
    git.listWorktrees.mockResolvedValue([{ path: reported, branch }]);

    const lease = await manager.acquire(acquireInput('/repo', true));

    expect(lease.branch).toBe(branch);
    expect(git.removeWorktree).not.toHaveBeenCalled();
    expect(git.addWorktree).not.toHaveBeenCalled();
  });

  it('recreates a registered worktree whose folder is gone instead of reusing it', async () => {
    const branch = buildBranchName('ENG-7', 'Retry me');
    const { manager, git, calls } = await setup();
    git.listWorktrees.mockResolvedValue([
      { path: join(manager.layout.worktrees, 'ENG-7'), branch },
    ]);

    await manager.acquire(acquireInput('/repo', true));

    expect(calls).toEqual(['remove', 'add']);
  });

  it.runIf(process.platform === 'win32')(
    'matches the forward-slash paths git prints on Windows',
    async () => {
      const branch = buildBranchName('ENG-7', 'Retry me');
      const { manager, git } = await setup();
      await mkdir(join(manager.layout.worktrees, 'ENG-7'), { recursive: true });
      const reported = join(manager.layout.worktrees, 'ENG-7').replace(/\\/g, '/').toUpperCase();
      git.listWorktrees.mockResolvedValue([{ path: reported, branch }]);

      await manager.acquire(acquireInput('C:\\repo', true));

      expect(git.addWorktree).not.toHaveBeenCalled();
    },
  );
});

describe('WorktreeManager.prune', () => {
  it('compares paths by filesystem identity, not spelling', async () => {
    const { manager, git } = await setup();
    const active = join(manager.layout.worktrees, 'ENG-1');
    const orphan = join(manager.layout.worktrees, 'ENG-2');
    git.listWorktrees.mockResolvedValue([
      { path: '/repo/', branch: 'main' },
      { path: `${active}/`, branch: 'agent/ENG-1' },
      { path: `${orphan}/`, branch: 'agent/ENG-2' },
      { path: '/elsewhere/ENG-3', branch: 'agent/ENG-3' },
    ]);

    const removed = await manager.prune('/repo', [active]);

    expect(removed).toEqual([`${orphan}/`]);
    expect(git.removeWorktree).toHaveBeenCalledTimes(1);
  });
});

describe('sameFilesystemPath', () => {
  it('ignores trailing separators', () => {
    expect(sameFilesystemPath('/a/b/', '/a/b')).toBe(true);
    expect(sameFilesystemPath('/a/b', '/a/c')).toBe(false);
  });
});
