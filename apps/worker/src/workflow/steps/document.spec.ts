import { AgentRunStatus, ArtifactKind, RunStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { documentStep } from './document';
import type { StepExecutionContext } from './types';

const output = (overrides: Record<string, unknown> = {}) => ({
  summary: 'Documented the health endpoint.',
  documents: [{ path: 'docs/health.md', title: 'Health endpoint', content: '# Health' }],
  gaps: [],
  ...overrides,
});

const context = (overrides: {
  execute?: ReturnType<typeof vi.fn>;
  createMany?: ReturnType<typeof vi.fn>;
  worktreePath?: string | null;
}): StepExecutionContext => {
  const execute =
    overrides.execute ??
    vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-run-1',
      output: output(),
    });

  return {
    worker: {
      prisma: {
        artifact: { createMany: overrides.createMany ?? vi.fn().mockResolvedValue({ count: 1 }) },
      },
      agents: { execute },
    },
    task: {
      id: 'task-1',
      key: 'ENG-1',
      worktreePath: overrides.worktreePath === undefined ? '/work/tree' : overrides.worktreePath,
      repository: null,
      project: { id: 'project-1', organizationId: 'org-1', maxReviewCycles: 3 },
    },
    state: {
      worktreePath: null,
      branchName: 'eng-1',
      requirement: 'Add a health endpoint',
      constraints: [],
      lastImplementationSummary: 'Added the route',
      plannerSummary: 'Plan',
    },
    run: { id: 'run-1' },
    step: { id: 'step-1' },
    traceId: 'trace-1',
    logger: { info: vi.fn(), warn: vi.fn() },
  } as unknown as StepExecutionContext;
};

describe('documentStep', () => {
  it('skips when there is no worktree to document', async () => {
    const result = await documentStep(context({ worktreePath: null }));
    expect(result.status).toBe(RunStatus.SKIPPED);
  });

  it('persists accepted documents as REPORT artifacts', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await documentStep(context({ createMany }));

    expect(result.status).toBe(RunStatus.SUCCEEDED);
    expect(createMany).toHaveBeenCalledTimes(1);

    const [call] = createMany.mock.calls;
    expect(call[0].data[0]).toMatchObject({
      taskId: 'task-1',
      agentRunId: 'agent-run-1',
      kind: ArtifactKind.REPORT,
      name: 'docs/health.md',
      contentType: 'text/markdown',
    });
  });

  it('fails when the agent fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ status: AgentRunStatus.FAILED, error: 'provider exploded' });
    const result = await documentStep(context({ execute }));

    expect(result.status).toBe(RunStatus.FAILED);
    expect(result.error).toBe('provider exploded');
  });

  it('fails when the agent output does not satisfy the schema', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-run-1',
      output: { summary: '' },
    });
    const result = await documentStep(context({ execute }));

    expect(result.status).toBe(RunStatus.FAILED);
  });

  // A path is model output, so it is untrusted. Each of these must be dropped
  // rather than normalised — the step stores an agent-chosen name, and a name
  // that escapes the repository has no legitimate reason to exist.
  it.each([
    ['traversal', '../../etc/passwd'],
    ['nested traversal', 'docs/../../secrets.md'],
    ['absolute posix', '/etc/passwd'],
    ['windows drive', 'C:/Windows/system.ini'],
    ['backslash', 'docs\\..\\secrets.md'],
  ])('rejects an unsafe document path (%s)', async (_label, path) => {
    const createMany = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-run-1',
      output: output({ documents: [{ path, title: 'Bad', content: 'x' }] }),
    });

    const result = await documentStep(context({ execute, createMany }));

    expect(result.status).toBe(RunStatus.SKIPPED);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('keeps the safe documents when only some are rejected', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-run-1',
      output: output({
        documents: [
          { path: '../escape.md', title: 'Bad', content: 'x' },
          { path: 'docs/good.md', title: 'Good', content: '# Good' },
        ],
      }),
    });

    const result = await documentStep(context({ execute, createMany }));

    expect(result.status).toBe(RunStatus.SUCCEEDED);
    expect(result.output).toMatchObject({ documents: 1, rejected: 1 });

    const [call] = createMany.mock.calls;
    expect(call[0].data).toHaveLength(1);
    expect(call[0].data[0].name).toBe('docs/good.md');
  });

  it('rejects an oversized document rather than storing it', async () => {
    const createMany = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-run-1',
      output: output({
        documents: [{ path: 'docs/huge.md', title: 'Huge', content: 'x'.repeat(256_001) }],
      }),
    });

    const result = await documentStep(context({ execute, createMany }));

    expect(result.status).toBe(RunStatus.SKIPPED);
    expect(createMany).not.toHaveBeenCalled();
  });
});
