import { RunStatus, TaskStatus, WorkflowStepKey } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowEngine } from './workflow-engine';
import { STEP_HANDLERS } from './steps';

describe('WorkflowEngine ownership integrity', () => {
  it('does not resurrect a pending run cancelled before its start claim', async () => {
    const stepCreate = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const engine = new WorkflowEngine({
      prisma: {
        workflowRun: {
          findUnique: vi.fn()
            .mockResolvedValueOnce({
              id: 'workflow-1', taskId: 'task-1', projectId: 'project-1',
              definitionKey: 'engineering-task', status: RunStatus.PENDING, steps: [], state: {},
            })
            .mockResolvedValueOnce({ status: RunStatus.CANCELLED }),
          updateMany,
        },
        task: { findUnique: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1', maxAttempts: 3,
          project: { id: 'project-1', organizationId: 'org-1', maxReviewCycles: 2, permissionLevel: 'LEVEL_2_CODE' },
        }) },
        workflowStep: { create: stepCreate },
      },
      audit: { record: vi.fn() },
      logger: { withContext: vi.fn().mockReturnValue({ info: vi.fn() }) },
    } as never);

    await expect(engine.advance('workflow-1', 'trace-1')).resolves.toMatchObject({
      status: RunStatus.CANCELLED, shouldContinue: false,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'workflow-1', status: RunStatus.PENDING },
    }));
    expect(stepCreate).not.toHaveBeenCalled();
  });

  it('drops a step result when cancellation wins during its handler', async () => {
    let releaseHandler: (() => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const original = STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY];
    STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = async () => {
      resolveStarted?.();
      await new Promise<void>((resolve) => { releaseHandler = resolve; });
      return { status: RunStatus.SUCCEEDED };
    };
    const stepUpdate = vi.fn();
    const runUpdate = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.PLANNING }]),
      workflowRun: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'workflow-1', taskId: 'task-1', projectId: 'project-1',
            definitionKey: 'engineering-task', status: RunStatus.RUNNING, steps: [], state: {},
          })
          .mockResolvedValueOnce({ status: RunStatus.CANCELLED }),
        updateMany: runUpdate,
      },
      workflowStep: {
        create: vi.fn().mockResolvedValue({ id: 'step-1', attempt: 1 }),
        update: stepUpdate,
      },
      task: { findUnique: vi.fn().mockResolvedValue({
        id: 'task-1', key: 'ENG-1', projectId: 'project-1', maxAttempts: 3,
        project: { id: 'project-1', organizationId: 'org-1', maxReviewCycles: 2, permissionLevel: 'LEVEL_2_CODE' },
      }), findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'task-1', key: 'ENG-1', projectId: 'project-1', status: TaskStatus.PLANNING,
      }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    };
    const engine = new WorkflowEngine({
      prisma,
      audit: { record: vi.fn() },
      logger: { withContext: vi.fn().mockReturnValue({ info: vi.fn() }) },
    } as never);

    try {
      const pending = engine.advance('workflow-1', 'trace-1');
      await handlerStarted;
      releaseHandler?.();
      await expect(pending).resolves.toMatchObject({ status: RunStatus.CANCELLED, shouldContinue: false });
      expect(stepUpdate).not.toHaveBeenCalled();
    } finally {
      STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = original;
    }
  });

  it('lets only one duplicate delivery claim and execute a workflow step', async () => {
    let releaseHandler: (() => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const original = STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY];
    const handler = vi.fn(async () => {
      resolveStarted?.();
      await new Promise<void>((resolve) => { releaseHandler = resolve; });
      return { status: RunStatus.SUCCEEDED };
    });
    STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = handler;

    const observedVersion = new Date('2026-09-19T00:00:00.000Z');
    let stepClaimed = false;
    const runUpdate = vi.fn().mockImplementation(async ({ data }: {
      data: { currentStepKey?: WorkflowStepKey | null };
    }) => {
      if (data.currentStepKey === WorkflowStepKey.ANALYZE_REPOSITORY) {
        if (stepClaimed) return { count: 0 };
        stepClaimed = true;
        return { count: 1 };
      }
      return { count: 1 };
    });
    const run = {
      id: 'workflow-1', taskId: 'task-1', projectId: 'project-1',
      definitionKey: 'engineering-task', status: RunStatus.RUNNING,
      currentStepKey: null, updatedAt: observedVersion, steps: [], state: {},
    };
    const stepStartedAt = new Date('2026-09-19T00:00:01.000Z');
    const stepCreate = vi.fn().mockResolvedValue({
      id: 'step-1', attempt: 1, status: RunStatus.RUNNING, startedAt: stepStartedAt,
    });
    const stepUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.PLANNING }]),
      workflowRun: {
        findUnique: vi.fn().mockImplementation(async ({ select }: { select?: unknown }) =>
          select ? { status: RunStatus.RUNNING } : run,
        ),
        updateMany: runUpdate,
      },
      workflowStep: { create: stepCreate, updateMany: stepUpdate },
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1', maxAttempts: 3,
          project: {
            id: 'project-1', organizationId: 'org-1', maxReviewCycles: 2,
            permissionLevel: 'LEVEL_2_CODE',
          },
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1',
          status: TaskStatus.PLANNING, project: { organizationId: 'org-1' },
        }),
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    };
    const engine = new WorkflowEngine({
      prisma,
      audit: { record: vi.fn() },
      logger: { withContext: vi.fn().mockReturnValue({ info: vi.fn() }) },
    } as never);

    try {
      const first = engine.advance('workflow-1', 'trace-1');
      await handlerStarted;
      const duplicate = engine.advance('workflow-1', 'trace-2');
      await expect(duplicate).resolves.toMatchObject({ shouldContinue: false });
      releaseHandler?.();
      await expect(first).resolves.toMatchObject({
        stepKey: WorkflowStepKey.ANALYZE_REPOSITORY,
        status: RunStatus.SUCCEEDED,
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(stepCreate).toHaveBeenCalledOnce();
      expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: 'workflow-1',
          status: RunStatus.RUNNING,
          currentStepKey: null,
          updatedAt: observedVersion,
        },
      }));
      expect(stepUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'step-1', attempt: 1, startedAt: stepStartedAt,
        }),
      }));
    } finally {
      STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = original;
    }
  });

  it('reclaims an expired step lease with a new attempt token after worker loss', async () => {
    const original = STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY];
    const handler = vi.fn().mockResolvedValue({ status: RunStatus.SUCCEEDED });
    STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = handler;
    const oldStartedAt = new Date('2026-09-19T00:00:00.000Z');
    const reclaimedStartedAt = new Date('2026-09-19T00:01:00.000Z');
    const abandonedStep = {
      id: 'step-1', workflowRunId: 'workflow-1',
      stepKey: WorkflowStepKey.ANALYZE_REPOSITORY,
      status: RunStatus.RUNNING, sequence: 0, attempt: 1, maxAttempts: 2,
      startedAt: oldStartedAt, finishedAt: null, durationMs: null,
      input: null, output: null, error: null,
      createdAt: oldStartedAt, updatedAt: oldStartedAt,
    };
    const stepUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.PLANNING }]),
      workflowRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'workflow-1', taskId: 'task-1', projectId: 'project-1',
          definitionKey: 'engineering-task', status: RunStatus.RUNNING,
          currentStepKey: WorkflowStepKey.ANALYZE_REPOSITORY,
          updatedAt: new Date(Date.now() - 60_000),
          steps: [abandonedStep], state: {},
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workflowStep: {
        updateMany: stepUpdate,
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...abandonedStep, attempt: 2, startedAt: reclaimedStartedAt,
        }),
      },
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1', maxAttempts: 3,
          project: {
            id: 'project-1', organizationId: 'org-1', maxReviewCycles: 2,
            permissionLevel: 'LEVEL_2_CODE',
          },
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1',
          status: TaskStatus.PLANNING, project: { organizationId: 'org-1' },
        }),
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    };
    const engine = new WorkflowEngine({
      prisma,
      audit: { record: vi.fn() },
      logger: { withContext: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn() }) },
    } as never);

    try {
      await expect(engine.advance('workflow-1', 'trace-retry')).resolves.toMatchObject({
        status: RunStatus.SUCCEEDED,
        stepKey: WorkflowStepKey.ANALYZE_REPOSITORY,
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(stepUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { id: 'step-1', status: RunStatus.RUNNING, attempt: 1 },
        data: expect.objectContaining({ attempt: 2, status: RunStatus.RUNNING }),
      }));
      expect(stepUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          id: 'step-1', status: RunStatus.RUNNING, attempt: 2,
          startedAt: reclaimedStartedAt,
        }),
      }));
    } finally {
      STEP_HANDLERS[WorkflowStepKey.ANALYZE_REPOSITORY] = original;
    }
  });

  it('refuses cancellation when the linked task belongs to another project', async () => {
    const update = vi.fn();
    const taskUpdate = vi.fn();
    const engine = new WorkflowEngine({
      prisma: {
        workflowRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'workflow-1',
            projectId: 'project-1',
            taskId: 'task-1',
            task: { projectId: 'project-2' },
          }),
          update,
        },
        task: { updateMany: taskUpdate },
      },
      audit: { record: vi.fn() },
      logger: { warn: vi.fn() },
    } as never);

    await expect(engine.cancel('workflow-1', 'stop')).rejects.toThrow(
      'does not belong to its project',
    );
    expect(update).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('fails a cross-project run before executing any workflow step', async () => {
    const workflowUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const stepCreate = vi.fn();
    const taskUpdate = vi.fn();
    const engine = new WorkflowEngine({
      prisma: {
        workflowRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'workflow-1',
            projectId: 'project-1',
            taskId: 'task-1',
            status: RunStatus.PENDING,
            steps: [],
          }),
          updateMany: workflowUpdate,
        },
        workflowStep: { create: stepCreate },
        task: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'task-1',
            projectId: 'project-2',
            status: TaskStatus.QUEUED,
            project: {},
          }),
          updateMany: taskUpdate,
        },
      },
      audit: { record: vi.fn() },
      logger: { warn: vi.fn() },
    } as never);

    const result = await engine.advance('workflow-1', 'trace-1');

    expect(result).toMatchObject({ decision: 'FAIL', status: RunStatus.FAILED });
    expect(workflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'workflow-1',
          status: {
            in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN],
          },
        },
        data: expect.objectContaining({ status: RunStatus.FAILED }),
      }),
    );
    expect(stepCreate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('does not mutate or transition an already-terminal workflow run', async () => {
    const updateMany = vi.fn();
    const taskLookup = vi.fn();
    const engine = new WorkflowEngine({
      prisma: {
        workflowRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'workflow-1',
            projectId: 'project-1',
            taskId: 'task-1',
            task: { projectId: 'project-1' },
            status: RunStatus.SUCCEEDED,
          }),
          updateMany,
        },
        task: { findUniqueOrThrow: taskLookup },
      },
      audit: { record: vi.fn() },
      logger: { warn: vi.fn() },
    } as never);

    await expect(engine.cancel('workflow-1', 'stop')).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
    expect(taskLookup).not.toHaveBeenCalled();
  });

  it('transitions the task only when it wins the active-run cancellation claim', async () => {
    const taskLookup = vi.fn();
    const engine = new WorkflowEngine({
      prisma: {
        workflowRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'workflow-1',
            projectId: 'project-1',
            taskId: 'task-1',
            task: { projectId: 'project-1' },
            status: RunStatus.RUNNING,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        task: { findUniqueOrThrow: taskLookup },
      },
      audit: { record: vi.fn() },
      logger: { warn: vi.fn() },
    } as never);

    await expect(engine.cancel('workflow-1', 'stop')).resolves.toBeUndefined();
    expect(taskLookup).not.toHaveBeenCalled();
  });
});
