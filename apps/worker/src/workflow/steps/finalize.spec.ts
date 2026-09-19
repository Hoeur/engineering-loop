import { RepositoryProvider, RunStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { completeStep } from './finalize';

const createContext = (input: {
  provider: string;
  pullRequest?: { local: boolean; number: number | null; url: string | null } | null;
  pushed?: boolean;
}) => {
  const transition = vi.fn().mockResolvedValue(undefined);
  const worker = {
    prisma: {
      testRun: { findFirst: vi.fn().mockResolvedValue({ passed: true }) },
      reviewFinding: { count: vi.fn().mockResolvedValue(0) },
      pullRequest: { findFirst: vi.fn().mockResolvedValue(input.pullRequest ?? null) },
      gitBranch: {
        findUnique: vi.fn().mockResolvedValue({ pushed: input.pushed ?? false }),
      },
    },
    gitManager: {
      isClean: vi.fn().mockResolvedValue(true),
      releaseWorktree: vi.fn().mockResolvedValue(undefined),
    },
  };
  const context = {
    worker,
    task: {
      id: 'task-1',
      branchName: 'agent/ENG-1',
      worktreePath: '/worktree',
      acceptanceCriteria: ['Real delivery'],
      repository: { id: 'repository-1', provider: input.provider },
    },
    state: { reviewApproved: true },
    traceId: 'trace-1',
    transitions: { to: transition },
  };
  return { context: context as never, transition, worker };
};

describe('completeStep GitHub delivery gate', () => {
  it('sends an otherwise complete GitHub task to human review when the real PR is missing', async () => {
    const { context, transition } = createContext({
      provider: RepositoryProvider.GITHUB,
      pullRequest: null,
      pushed: true,
    });

    const outcome = await completeStep(context);

    expect(outcome.status).toBe(RunStatus.FAILED);
    expect(outcome.error).toContain('githubDeliveryComplete');
    expect(transition).not.toHaveBeenCalled();
  });

  it('allows completion only after a real numbered GitHub PR and pushed branch exist', async () => {
    const { context, transition } = createContext({
      provider: RepositoryProvider.GITHUB,
      pullRequest: {
        local: false,
        number: 42,
        url: 'https://github.com/engloop/repository/pull/42',
      },
      pushed: true,
    });

    const outcome = await completeStep(context);

    expect(outcome.status).toBe(RunStatus.SUCCEEDED);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    ['local placeholder', { local: true, number: 42, url: 'https://github.com/pull/42' }, true],
    ['missing number', { local: false, number: null, url: 'https://github.com/pull/42' }, true],
    ['missing URL', { local: false, number: 42, url: null }, true],
    ['unpushed branch', { local: false, number: 42, url: 'https://github.com/pull/42' }, false],
  ])('blocks GitHub completion for %s', async (_label, pullRequest, pushed) => {
    const { context } = createContext({
      provider: RepositoryProvider.GITHUB,
      pullRequest,
      pushed,
    });

    const outcome = await completeStep(context);

    expect(outcome.status).toBe(RunStatus.FAILED);
    expect(outcome.error).toContain('githubDeliveryComplete');
  });

  it('does not apply the GitHub delivery gate to LOCAL repositories', async () => {
    const { context, transition, worker } = createContext({
      provider: RepositoryProvider.LOCAL,
    });

    const outcome = await completeStep(context);

    expect(outcome.status).toBe(RunStatus.SUCCEEDED);
    expect(worker.prisma.pullRequest.findFirst).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });
});
