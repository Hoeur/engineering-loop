import { AgentRunStatus, RunStatus, Severity, Viewport } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { uiQaStep } from './ui-qa';
import type { StepExecutionContext } from './types';

const screenshot = (overrides: Record<string, unknown> = {}) => ({
  id: 'shot-1',
  page: '/',
  viewport: Viewport.DESKTOP,
  width: 1440,
  height: 900,
  storagePath: '/tmp/shot-1.png',
  consoleErrors: [],
  failedRequests: [],
  ...overrides,
});

const context = (overrides: {
  screenshots?: ReturnType<typeof screenshot>[];
  execute?: ReturnType<typeof vi.fn>;
  persistUi?: ReturnType<typeof vi.fn>;
  worktreePath?: string | null;
}): StepExecutionContext => {
  const findMany = vi.fn().mockResolvedValue(overrides.screenshots ?? []);
  return {
    worker: {
      prisma: {
        screenshot: { findMany },
        reviewRun: {
          create: vi.fn().mockResolvedValue({ id: 'review-1' }),
          update: vi.fn(),
        },
      },
      agents: { execute: overrides.execute ?? vi.fn() },
      reviews: {
        persistUi:
          overrides.persistUi ??
          vi.fn().mockResolvedValue({
            decision: 'APPROVED',
            findingCount: 0,
            blockingCount: 0,
            approved: true,
          }),
      },
    },
    task: {
      id: 'task-1',
      key: 'ENG-1',
      worktreePath: overrides.worktreePath === undefined ? '/work/tree' : overrides.worktreePath,
      repository: null,
      project: { id: 'project-1', organizationId: 'org-1', maxReviewCycles: 3 },
    },
    state: { worktreePath: null, branchName: 'eng-1', reviewCycle: 0 },
    run: { id: 'run-1' },
    step: { id: 'step-1' },
    traceId: 'trace-1',
    logger: { info: vi.fn(), warn: vi.fn() },
  } as unknown as StepExecutionContext;
};

describe('UI QA step', () => {
  it('skips without a worktree rather than failing the task', async () => {
    const outcome = await uiQaStep(context({ worktreePath: null }));
    expect(outcome.status).toBe(RunStatus.SKIPPED);
  });

  it('skips when no screenshots were captured, instead of approving on no evidence', async () => {
    const execute = vi.fn();
    const outcome = await uiQaStep(context({ screenshots: [], execute }));

    expect(outcome.status).toBe(RunStatus.SKIPPED);
    // The point: a UI review with nothing to look at must not reach the model
    // and must not produce a verdict.
    expect(execute).not.toHaveBeenCalled();
  });

  it('sends the captured screenshots to the reviewer and persists its findings', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-1',
      output: {
        decision: 'changes_requested',
        summary: 'Overflow on mobile.',
        findings: [
          {
            severity: Severity.HIGH,
            category: 'OVERFLOW',
            viewport: Viewport.MOBILE,
            page: '/',
            problem: 'Content overflows horizontally.',
            requiredFix: 'Constrain the container width.',
            screenshotId: 'shot-1',
          },
        ],
      },
    });
    const persistUi = vi.fn().mockResolvedValue({
      decision: 'CHANGES_REQUESTED',
      findingCount: 1,
      blockingCount: 1,
      approved: false,
    });

    const outcome = await uiQaStep(
      context({
        screenshots: [screenshot({ consoleErrors: ['boom'], failedRequests: ['GET /x 404'] })],
        execute,
        persistUi,
      }),
    );

    expect(outcome.status).toBe(RunStatus.SUCCEEDED);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          pages: ['/'],
          screenshots: [expect.objectContaining({ id: 'shot-1', viewport: Viewport.DESKTOP })],
          consoleErrors: ['boom'],
          failedRequests: ['GET /x 404'],
        }),
      }),
    );
    expect(persistUi).toHaveBeenCalled();
    // A blocking finding re-opens the bounded fix loop.
    expect(outcome.patch).toMatchObject({ hasBlockingFindings: true });
  });

  it('does not re-open the fix loop for a non-blocking finding', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-1',
      output: { decision: 'approved', summary: 'Fine.', findings: [] },
    });

    const outcome = await uiQaStep(context({ screenshots: [screenshot()], execute }));

    expect(outcome.status).toBe(RunStatus.SUCCEEDED);
    expect(outcome.patch).not.toHaveProperty('hasBlockingFindings');
  });

  it('nulls a screenshotId that does not belong to this task', async () => {
    // Model output is untrusted: a hallucinated or foreign id must never be
    // stored as a dangling reference.
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-1',
      output: {
        decision: 'changes_requested',
        summary: 'Spacing.',
        findings: [
          {
            severity: Severity.LOW,
            category: 'SPACING',
            viewport: Viewport.DESKTOP,
            page: '/',
            problem: 'Cramped.',
            requiredFix: 'Add padding.',
            screenshotId: 'shot-from-another-task',
          },
        ],
      },
    });
    const persistUi = vi.fn().mockResolvedValue({
      decision: 'CHANGES_REQUESTED',
      findingCount: 1,
      blockingCount: 0,
      approved: false,
    });

    await uiQaStep(context({ screenshots: [screenshot()], execute, persistUi }));

    expect(persistUi).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          findings: [expect.objectContaining({ screenshotId: null })],
        }),
      }),
    );
  });

  it('fails the step when the reviewer returns output the schema rejects', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.SUCCEEDED,
      agentRunId: 'agent-1',
      output: { decision: 'not-a-decision' },
    });
    const persistUi = vi.fn();

    const outcome = await uiQaStep(context({ screenshots: [screenshot()], execute, persistUi }));

    expect(outcome.status).toBe(RunStatus.FAILED);
    expect(persistUi).not.toHaveBeenCalled();
  });

  it('fails the step when the agent run itself fails', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: AgentRunStatus.FAILED,
      agentRunId: 'agent-1',
      error: 'provider exploded',
      output: null,
    });
    const persistUi = vi.fn();

    const outcome = await uiQaStep(context({ screenshots: [screenshot()], execute, persistUi }));

    expect(outcome.status).toBe(RunStatus.FAILED);
    expect(outcome.error).toBe('provider exploded');
    expect(persistUi).not.toHaveBeenCalled();
  });
});
