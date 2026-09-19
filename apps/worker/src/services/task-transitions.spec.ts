import { AgentRunStatus, RunStatus, TaskStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { TaskTransitions } from './task-transitions';

describe('TaskTransitions optimistic writes', () => {
  it('does not audit when another writer wins a transition race', async () => {
    const record = vi.fn();
    const prisma = {
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1',
          key: 'ENG-1',
          status: TaskStatus.TESTING,
          projectId: 'project-1',
          project: { organizationId: 'org-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const transitions = new TaskTransitions(
      prisma as never,
      { record } as never,
      { warn: vi.fn() } as never,
    );

    await expect(transitions.to('task-1', TaskStatus.REVIEWING)).rejects.toThrow(
      'changed concurrently',
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('conditionally applies same-status data updates', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1',
          key: 'ENG-1',
          status: TaskStatus.BLOCKED,
          projectId: 'project-1',
          project: { organizationId: 'org-1' },
        }),
        updateMany,
      },
    };
    const transitions = new TaskTransitions(
      prisma as never,
      { record: vi.fn() } as never,
      { warn: vi.fn() } as never,
    );

    await expect(
      transitions.to('task-1', TaskStatus.BLOCKED, { data: { blockedReason: 'still blocked' } }),
    ).rejects.toThrow('changed concurrently');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1', status: TaskStatus.BLOCKED } }),
    );
  });

  it('throws when the requested transition is unreachable', async () => {
    const record = vi.fn();
    const prisma = {
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1',
          key: 'ENG-1',
          status: TaskStatus.COMPLETED,
          projectId: 'project-1',
          project: { organizationId: 'org-1' },
        }),
        updateMany: vi.fn(),
      },
    };
    const transitions = new TaskTransitions(
      prisma as never,
      { record } as never,
      { warn: vi.fn() } as never,
    );

    await expect(transitions.to('task-1', TaskStatus.QUEUED)).rejects.toThrow(
      'cannot transition',
    );
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('TaskTransitions terminal workflow claim', () => {
  it('rolls back workflow success when task completion fails, then succeeds on retry', async () => {
    let taskStatus = TaskStatus.APPROVED;
    let workflowStatus = RunStatus.RUNNING;
    let failTaskWrite = true;
    const record = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      task: {
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1', status: taskStatus,
          project: { organizationId: 'org-1' },
        })),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: TaskStatus } }) => {
          if (failTaskWrite) throw new Error('task write failed');
          taskStatus = data.status;
          return { count: 1 };
        }),
      },
      workflowRun: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: RunStatus } }) => {
          if (workflowStatus !== RunStatus.RUNNING) return { count: 0 };
          workflowStatus = data.status;
          return { count: 1 };
        }),
      },
      workflowStep: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      agentRun: {
        updateManyAndReturn: vi.fn().mockResolvedValue([]),
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const before = { taskStatus, workflowStatus };
        try {
          return await callback(tx);
        } catch (error) {
          taskStatus = before.taskStatus;
          workflowStatus = before.workflowStatus;
          throw error;
        }
      }),
    };
    const transitions = new TaskTransitions(
      prisma as never, { record } as never, { warn: vi.fn() } as never,
    );

    await expect(transitions.finishWorkflow(
      'workflow-1', 'task-1', RunStatus.SUCCEEDED, TaskStatus.COMPLETED, 'done', 'trace-1',
    )).rejects.toThrow('task write failed');
    expect({ taskStatus, workflowStatus }).toEqual({
      taskStatus: TaskStatus.APPROVED, workflowStatus: RunStatus.RUNNING,
    });
    expect(record).not.toHaveBeenCalled();

    failTaskWrite = false;
    await expect(transitions.finishWorkflow(
      'workflow-1', 'task-1', RunStatus.SUCCEEDED, TaskStatus.COMPLETED, 'done', 'trace-1',
    )).resolves.toBe(true);
    expect({ taskStatus, workflowStatus }).toEqual({
      taskStatus: TaskStatus.COMPLETED, workflowStatus: RunStatus.SUCCEEDED,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('does not change task status when cancellation already claimed the workflow', async () => {
    const taskUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      task: { findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'task-1', key: 'ENG-1', status: TaskStatus.CANCELLED,
        projectId: 'project-1', project: { organizationId: 'org-1' },
      }), updateMany: taskUpdate },
      workflowRun: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const transitions = new TaskTransitions(
      { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as never,
      { record: vi.fn() } as never, { warn: vi.fn() } as never,
    );
    await expect(transitions.finishWorkflow(
      'workflow-1', 'task-1', RunStatus.SUCCEEDED, TaskStatus.COMPLETED, 'done', 'trace-1',
    )).resolves.toBe(false);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('atomically supersedes active sibling workflows, steps, and agents', async () => {
    const workflowUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const stepUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const agentUpdate = vi.fn().mockResolvedValue([{
      id: 'agent-2', role: 'IMPLEMENTER', providerKey: 'codex',
    }]);
    const createAudits = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1', key: 'ENG-1', status: TaskStatus.APPROVED,
          projectId: 'project-1', project: { organizationId: 'org-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workflowRun: {
        updateMany: workflowUpdate,
        findMany: vi.fn().mockResolvedValue([{ id: 'workflow-2' }]),
      },
      workflowStep: { updateMany: stepUpdate },
      agentRun: {
        updateManyAndReturn: agentUpdate,
      },
      auditLog: { createMany: createAudits },
    };
    const transitions = new TaskTransitions(
      { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as never,
      { record: vi.fn() } as never,
      { warn: vi.fn() } as never,
    );

    await expect(transitions.finishWorkflow(
      'workflow-1', 'task-1', RunStatus.SUCCEEDED, TaskStatus.COMPLETED, 'done', 'trace-1',
    )).resolves.toBe(true);
    expect(workflowUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['workflow-2'] } }),
      data: expect.objectContaining({ status: RunStatus.CANCELLED }),
    }));
    expect(stepUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workflowRunId: { in: ['workflow-2'] } }),
      data: expect.objectContaining({ status: RunStatus.CANCELLED }),
    }));
    expect(agentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { taskId: 'task-1' },
          { workflowRunId: { in: ['workflow-2'] } },
          { workflowStep: { workflowRunId: { in: ['workflow-2'] } } },
        ]),
      }),
      data: expect.objectContaining({ status: AgentRunStatus.CANCELLED }),
    }));
    expect(createAudits).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        action: 'AGENT_STOPPED', entityId: 'agent-2', organizationId: 'org-1',
      })],
    }));
  });
});
