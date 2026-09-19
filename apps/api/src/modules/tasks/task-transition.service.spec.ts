import { describe, expect, it, vi } from 'vitest';
import { AgentRunStatus, RunStatus, TaskStatus } from '@engloop/types';
import { InvalidTransitionError } from '@engloop/workflow';
import { TaskTransitionService } from './task-transition.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EventBus } from '../../infrastructure/events/event-bus';
import type { AuditService } from '../audit/audit.service';

const makeService = (currentStatus: TaskStatus) => {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const task = {
    id: 't1',
    key: 'ENG-101',
    status: currentStatus,
    projectId: 'p1',
    project: { organizationId: 'o1' },
  };
  const prisma = {
    task: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(task),
      updateMany,
    },
  } as unknown as PrismaService;

  const events = { publish: vi.fn() } as unknown as EventBus;
  const audit = { recordSafe: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new TaskTransitionService(prisma, events, audit), updateMany, events, audit };
};

describe('TaskTransitionService', () => {
  it('performs a legal transition and emits an event', async () => {
    const { service, updateMany, events } = makeService(TaskStatus.TESTING);
    await service.transition('t1', TaskStatus.REVIEWING);

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls[0]?.[0].where).toEqual({ id: 't1', status: TaskStatus.TESTING });
    expect(updateMany.mock.calls[0]?.[0].data.status).toBe(TaskStatus.REVIEWING);
    expect(events.publish).toHaveBeenCalledOnce();
  });

  it('refuses an illegal transition before touching the database', async () => {
    const { service, updateMany } = makeService(TaskStatus.TESTING);
    await expect(service.transition('t1', TaskStatus.COMPLETED)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op when the task is already in the target state', async () => {
    const { service, events } = makeService(TaskStatus.REVIEWING);
    await service.transition('t1', TaskStatus.REVIEWING);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('stamps completedAt on a terminal transition', async () => {
    const { service, updateMany } = makeService(TaskStatus.MERGED);
    await service.transition('t1', TaskStatus.COMPLETED);
    expect(updateMany.mock.calls[0]?.[0].data.completedAt).toBeDefined();
  });

  it('records the blocked reason when moving to BLOCKED', async () => {
    const { service, updateMany } = makeService(TaskStatus.QUEUED);
    await service.transition('t1', TaskStatus.BLOCKED, { reason: 'waiting on credentials' });
    expect(updateMany.mock.calls[0]?.[0].data.blockedReason).toBe('waiting on credentials');
  });

  it('exposes the legal next states for the UI', () => {
    const { service } = makeService(TaskStatus.BACKLOG);
    expect(service.allowedNext(TaskStatus.BACKLOG)).toContain(TaskStatus.PLANNING);
    expect(service.canTransition(TaskStatus.BACKLOG, TaskStatus.MERGED)).toBe(false);
  });

  it('writes an audit entry for every transition', async () => {
    const { service, audit } = makeService(TaskStatus.TESTING);
    await service.transition('t1', TaskStatus.REVIEWING);
    expect(audit.recordSafe).toHaveBeenCalledOnce();
  });

  it('does not publish or audit when another writer wins the status race', async () => {
    const { service, updateMany, events, audit } = makeService(TaskStatus.TESTING);
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.transition('t1', TaskStatus.REVIEWING)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(events.publish).not.toHaveBeenCalled();
    expect(audit.recordSafe).not.toHaveBeenCalled();
  });
});

describe('TaskTransitionService atomic cancellation', () => {
  it('rolls back workflow and step cancellation when the task write fails', async () => {
    let taskStatus: TaskStatus = TaskStatus.IMPLEMENTING;
    let workflowStatus: RunStatus = RunStatus.RUNNING;
    let stepStatus: RunStatus = RunStatus.RUNNING;
    let agentStatus: AgentRunStatus = AgentRunStatus.RUNNING;
    let failTaskWrite = true;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      task: {
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          id: 'task-1', key: 'ENG-1', projectId: 'project-1', status: taskStatus,
        })),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: TaskStatus } }) => {
          if (failTaskWrite) throw new Error('task write failed');
          taskStatus = data.status;
          return { count: 1 };
        }),
      },
      workflowRun: {
        findMany: vi.fn().mockImplementation(async () =>
          workflowStatus === RunStatus.RUNNING ? [{ id: 'workflow-1' }] : [],
        ),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: RunStatus } }) => {
          workflowStatus = data.status;
          return { count: 1 };
        }),
      },
      workflowStep: {
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: RunStatus } }) => {
          stepStatus = data.status;
          return { count: 1 };
        }),
      },
      agentRun: {
        updateManyAndReturn: vi.fn().mockImplementation(async ({ data }: {
          data: { status: AgentRunStatus };
        }) => {
          agentStatus = data.status;
          return [{
            id: 'agent-1', role: 'IMPLEMENTER', providerKey: 'codex', taskId: 'task-1',
          }];
        }),
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const before = { taskStatus, workflowStatus, stepStatus, agentStatus };
        try {
          return await callback(tx);
        } catch (error) {
          taskStatus = before.taskStatus;
          workflowStatus = before.workflowStatus;
          stepStatus = before.stepStatus;
          agentStatus = before.agentStatus;
          throw error;
        }
      }),
    } as unknown as PrismaService;
    const events = { publish: vi.fn() } as unknown as EventBus;
    const audit = { recordSafe: vi.fn() } as unknown as AuditService;
    const service = new TaskTransitionService(prisma, events, audit);

    await expect(service.cancelWithWorkflows('org-1', 'task-1', 'stop')).rejects.toThrow(
      'task write failed',
    );
    expect({ taskStatus, workflowStatus, stepStatus, agentStatus }).toEqual({
      taskStatus: TaskStatus.IMPLEMENTING,
      workflowStatus: RunStatus.RUNNING,
      stepStatus: RunStatus.RUNNING,
      agentStatus: AgentRunStatus.RUNNING,
    });
    expect(events.publish).not.toHaveBeenCalled();
    expect(audit.recordSafe).not.toHaveBeenCalled();

    failTaskWrite = false;
    await expect(service.cancelWithWorkflows('org-1', 'task-1', 'stop')).resolves.toMatchObject({
      task: { status: TaskStatus.CANCELLED }, workflowRunIds: ['workflow-1'],
    });
    expect({ taskStatus, workflowStatus, stepStatus, agentStatus }).toEqual({
      taskStatus: TaskStatus.CANCELLED,
      workflowStatus: RunStatus.CANCELLED,
      stepStatus: RunStatus.CANCELLED,
      agentStatus: AgentRunStatus.CANCELLED,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(events.publish).toHaveBeenCalledOnce();
    expect(audit.recordSafe).toHaveBeenCalledOnce();
  });

  it('cancels every active sibling workflow and agent when one workflow cancels the task', async () => {
    const workflowUpdate = vi.fn().mockResolvedValue({ count: 2 });
    const stepUpdate = vi.fn().mockResolvedValue({ count: 2 });
    const agentUpdate = vi.fn().mockResolvedValue([
      { id: 'agent-1', role: 'IMPLEMENTER', providerKey: 'codex', taskId: 'task-1' },
      { id: 'agent-2', role: 'REVIEWER', providerKey: 'codex', taskId: 'task-1' },
    ]);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      task: {
        findUniqueOrThrow: vi.fn()
          .mockResolvedValueOnce({
            id: 'task-1', key: 'ENG-1', projectId: 'project-1', status: TaskStatus.IMPLEMENTING,
          })
          .mockResolvedValueOnce({ id: 'task-1', status: TaskStatus.CANCELLED }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      workflowRun: {
        findMany: vi.fn().mockResolvedValue([{ id: 'workflow-1' }, { id: 'workflow-2' }]),
        updateMany: workflowUpdate,
      },
      workflowStep: { updateMany: stepUpdate },
      agentRun: {
        updateManyAndReturn: agentUpdate,
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new TaskTransitionService(
      prisma,
      { publish: vi.fn() } as unknown as EventBus,
      { recordSafe: vi.fn() } as unknown as AuditService,
    );

    await expect(
      service.cancelWithWorkflows('org-1', 'task-1', 'stop', 'workflow-1'),
    ).resolves.toMatchObject({ workflowRunIds: ['workflow-1', 'workflow-2'] });
    expect(tx.workflowRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ id: 'workflow-1' }),
    }));
    expect(workflowUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['workflow-1', 'workflow-2'] } }),
    }));
    expect(stepUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workflowRunId: { in: ['workflow-1', 'workflow-2'] } }),
    }));
    expect(agentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AgentRunStatus.CANCELLED }),
      where: expect.objectContaining({
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
        OR: expect.arrayContaining([
          { taskId: 'task-1' },
          { workflowRunId: { in: ['workflow-1', 'workflow-2'] } },
        ]),
      }),
    }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ action: 'AGENT_STOPPED', entityId: 'agent-1' }),
        expect.objectContaining({ action: 'AGENT_STOPPED', entityId: 'agent-2' }),
      ]),
    }));
  });
});
