import type { CommandResult } from '@engloop/types';
import { RepositoryProvider } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { GitHubDeliveryError, GitManager } from './git-manager';

const commandResult = (exitCode: number): CommandResult => ({
  command: 'git',
  args: ['push', '--set-upstream', 'origin', 'agent/ENG-1'],
  cwd: '/worktree',
  exitCode,
  signal: null,
  stdout: '',
  stderr: exitCode === 0 ? '' : 'access denied',
  truncated: false,
  timedOut: false,
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  durationMs: 1,
});

const githubTask = () => ({
  id: 'task-1',
  key: 'ENG-1',
  title: 'Ship GitHub integration',
  objective: 'Create a real pull request',
  description: null,
  acceptanceCriteria: ['Push the branch'],
  projectId: 'project-1',
  branchName: 'agent/ENG-1',
  worktreePath: '/worktree',
  project: { organizationId: 'organization-1' },
  repository: {
    id: 'repository-1',
    provider: RepositoryProvider.GITHUB,
    installationId: 'installation-1',
    githubRepositoryId: '12345',
    githubOwner: 'engloop',
    name: 'private-repository',
    remoteUrl: 'https://github.com/engloop/private-repository.git',
    localPath: null,
    defaultBranch: 'main',
  },
});

const createHarness = (pushExitCode = 0) => {
  const task = githubTask();
  const pullRequest = {
    id: 'pull-request-1',
    repositoryId: task.repository.id,
    branchId: 'branch-1',
    taskId: task.id,
    number: 42,
    title: `${task.key}: ${task.title}`,
    body: 'Created by EngLoop',
    status: 'OPEN',
    headBranch: task.branchName,
    baseBranch: 'main',
    draft: false,
    local: false,
    url: 'https://github.com/engloop/private-repository/pull/42',
  };
  const prisma = {
    task: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(task),
      update: vi.fn(),
    },
    gitBranch: {
      findUnique: vi.fn().mockResolvedValue({ id: 'branch-1', pushed: false }),
      update: vi.fn().mockResolvedValue({ id: 'branch-1', pushed: true }),
      upsert: vi.fn(),
    },
    gitWorktree: { upsert: vi.fn() },
    pullRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(pullRequest),
      update: vi.fn().mockResolvedValue(pullRequest),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  let tokenObservedByGit: string | undefined;
  const git = {
    push: vi.fn().mockImplementation(
      async (
        _path: string,
        _branch: string,
        _remote: string,
        authentication: { token: string },
      ) => {
        tokenObservedByGit = authentication.token;
        return commandResult(pushExitCode);
      },
    ),
  };
  const github = {
    createInstallationAccessToken: vi.fn().mockResolvedValue({
      token: 'short-lived-installation-token',
      expiresAt: '2026-09-11T08:00:00Z',
    }),
    createOrFindPullRequest: vi.fn().mockResolvedValue({
      id: 'github-pr-42',
      number: 42,
      title: pullRequest.title,
      body: pullRequest.body,
      state: 'open',
      draft: false,
      merged: false,
      htmlUrl: pullRequest.url,
      head: task.branchName,
      base: 'main',
      created: true,
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const logger = { warn: vi.fn(), info: vi.fn() };
  const manager = new GitManager({
    prisma: prisma as never,
    git: git as never,
    worktrees: {} as never,
    github: github as never,
    logger: logger as never,
    env: { GIT_BRANCH_PREFIX: 'agent' } as never,
    audit: audit as never,
  });
  return {
    manager,
    prisma,
    git,
    github,
    audit,
    task,
    tokenObservedByGit: () => tokenObservedByGit,
  };
};

describe('GitManager GitHub delivery', () => {
  it('pushes with repository-scoped auth and persists the real GitHub PR', async () => {
    const harness = createHarness();

    const pullRequest = await harness.manager.openPullRequest('task-1', 'trace-1');

    expect(harness.github.createInstallationAccessToken).toHaveBeenCalledWith('installation-1', {
      repositoryIds: ['12345'],
      permissions: { contents: 'write' },
    });
    expect(harness.tokenObservedByGit()).toBe('short-lived-installation-token');
    expect(harness.github.createOrFindPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'installation-1',
        repositoryId: '12345',
        owner: 'engloop',
        repo: 'private-repository',
        head: 'engloop:agent/ENG-1',
        base: 'main',
      }),
    );
    expect(harness.prisma.pullRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        number: 42,
        url: 'https://github.com/engloop/private-repository/pull/42',
        local: false,
      }),
    });
    expect(pullRequest).toMatchObject({ number: 42, local: false });
    expect(JSON.stringify(harness.prisma.pullRequest.create.mock.calls)).not.toContain(
      'short-lived-installation-token',
    );
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      'short-lived-installation-token',
    );
  });

  it('provisions GitHub source with a fresh scoped token and no local-path bypass', async () => {
    const harness = createHarness();
    let checkoutInput:
      | { localPath?: string | null; authentication?: { token: string } }
      | undefined;
    const worktrees = {
      ensureCheckout: vi.fn().mockImplementation(
        async (input: { localPath?: string | null; authentication?: { token: string } }) => {
          checkoutInput = {
            localPath: input.localPath,
            authentication: input.authentication
              ? { token: input.authentication.token }
              : undefined,
          };
          return '/checkout';
        },
      ),
      acquire: vi.fn().mockResolvedValue({
        path: '/worktree',
        branch: 'agent/ENG-1',
        baseRef: 'main',
      }),
    };
    harness.prisma.gitWorktree.upsert.mockResolvedValue({ id: 'worktree-1' });
    harness.prisma.gitBranch.upsert.mockResolvedValue({ id: 'branch-1' });
    harness.prisma.task.update.mockResolvedValue(harness.task);
    const manager = new GitManager({
      prisma: harness.prisma as never,
      git: harness.git as never,
      worktrees: worktrees as never,
      github: harness.github as never,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
      env: { GIT_BRANCH_PREFIX: 'agent' } as never,
      audit: harness.audit as never,
    });

    await manager.provisionWorktree({ taskId: 'task-1', traceId: 'trace-1' });

    expect(checkoutInput).toEqual({
      localPath: null,
      authentication: { token: 'short-lived-installation-token' },
    });
    expect(harness.github.createInstallationAccessToken).toHaveBeenCalledWith('installation-1', {
      repositoryIds: ['12345'],
      permissions: { contents: 'write' },
    });
  });

  it('fails closed without creating a placeholder when push fails', async () => {
    const harness = createHarness(128);

    await expect(harness.manager.openPullRequest('task-1', 'trace-1')).rejects.toMatchObject({
      name: 'GitHubDeliveryError',
      code: 'GITHUB_DELIVERY_FAILED',
      message: 'GitHub branch push failed',
    });
    expect(harness.github.createOrFindPullRequest).not.toHaveBeenCalled();
    expect(harness.prisma.pullRequest.create).not.toHaveBeenCalled();
    expect(harness.prisma.pullRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }),
    );
  });

  it('fails closed without creating a placeholder when GitHub PR creation fails', async () => {
    const harness = createHarness();
    harness.github.createOrFindPullRequest.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(harness.manager.openPullRequest('task-1', 'trace-1')).rejects.toBeInstanceOf(
      GitHubDeliveryError,
    );
    expect(harness.prisma.pullRequest.create).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing GitHub remote URLs before git runs', async () => {
    const harness = createHarness();
    harness.task.repository.remoteUrl =
      'https://short-lived-installation-token@github.com/engloop/private-repository.git';

    await expect(harness.manager.openPullRequest('task-1', 'trace-1')).rejects.toThrow(
      'GitHub remote URL must be canonical HTTPS',
    );
    expect(harness.git.push).not.toHaveBeenCalled();
  });

  it('requires a tracked database branch before external delivery', async () => {
    const harness = createHarness();
    harness.prisma.gitBranch.findUnique.mockResolvedValueOnce(null);

    await expect(harness.manager.openPullRequest('task-1', 'trace-1')).rejects.toThrow(
      'GitHub delivery requires a tracked branch',
    );
    expect(harness.git.push).not.toHaveBeenCalled();
  });

  it('retains local placeholder PR behavior only for LOCAL repositories', async () => {
    const harness = createHarness();
    harness.task.repository.provider = RepositoryProvider.LOCAL;

    const pullRequest = await harness.manager.openPullRequest('task-1', 'trace-1');

    expect(harness.github.createInstallationAccessToken).not.toHaveBeenCalled();
    expect(harness.git.push).not.toHaveBeenCalled();
    expect(harness.prisma.pullRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ local: true, url: null }),
    });
    expect(pullRequest).toBeDefined();
  });

  it('treats an unreadable worktree status as not clean', async () => {
    const harness = createHarness();
    const manager = new GitManager({
      prisma: harness.prisma as never,
      git: { status: vi.fn().mockRejectedValue(new Error('worktree missing')) } as never,
      worktrees: {} as never,
      github: harness.github as never,
      logger: {} as never,
      env: {} as never,
      audit: harness.audit as never,
    });

    await expect(manager.isClean('/missing-worktree')).resolves.toBe(false);
  });
});
