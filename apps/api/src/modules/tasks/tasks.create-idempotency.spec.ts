import { Prisma, type Task } from '@engloop/db';
import type { CreateTaskDto } from '@engloop/schemas';
import { ApiErrorCode, Priority, RiskLevel, TaskStatus, TaskType } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TasksService } from './tasks.service';

const KEY = '80da1063-8f78-47ea-9a10-08ddc8c0c172';
const dto = (title = 'Add durable task creation'): CreateTaskDto => ({
  projectId: 'project-1',
  title,
  description: '',
  objective: '',
  type: TaskType.FEATURE,
  priority: Priority.MEDIUM,
  riskLevel: RiskLevel.MEDIUM,
  acceptanceCriteria: [],
  implementationNotes: [],
  suggestedFiles: [],
  requiredChecks: [],
  maxAttempts: 3,
  dependsOnTaskIds: [],
});

const task = {
  id: 'task-1',
  projectId: 'project-1',
  key: 'ENG-101',
  title: 'Add durable task creation',
  type: TaskType.FEATURE,
  priority: Priority.MEDIUM,
  status: TaskStatus.BACKLOG,
} as Task;

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['organizationId', 'key'] },
  });

const makeService = () => {
  const updateRequests = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    project: {
      update: vi.fn().mockResolvedValue({ key: 'ENG', taskSequence: 101 }),
    },
    task: { create: vi.fn().mockResolvedValue(task) },
    taskDependency: { createMany: vi.fn() },
    taskCreationRequest: {
      create: vi.fn().mockResolvedValue({ id: 'request-1' }),
      update: vi.fn().mockResolvedValue({ id: 'request-1', taskId: task.id }),
      updateMany: updateRequests,
    },
  };
  const findRequest = vi.fn().mockResolvedValue(null);
  const prisma = {
    project: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'project-1',
        organizationId: 'org-1',
        maxTaskAttempts: 3,
      }),
    },
    task: { findFirst: vi.fn().mockResolvedValue(task), count: vi.fn().mockResolvedValue(1) },
    taskCreationRequest: { findUnique: findRequest, updateMany: updateRequests },
    $transaction: vi
      .fn()
      .mockImplementation(async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
      ),
  } as unknown as PrismaService;
  const publish = vi.fn();
  const audit = vi.fn();
  const auditInTransaction = vi.fn();
  const service = new TasksService(
    prisma,
    { publish } as never,
    { recordSafe: audit, recordInTransaction: auditInTransaction } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    prisma,
    tx,
    findRequest,
    updateRequests,
    publish,
    audit,
    auditInTransaction,
  };
};

describe('task creation idempotency', () => {
  it('atomically stores the request, task, and dependencies, then replays without another event', async () => {
    const state = makeService();
    const request = { ...dto(), dependsOnTaskIds: ['task-dependency'] };

    await expect(state.service.create('org-1', request, 'user-1', KEY)).resolves.toBe(task);
    const requestHash = state.tx.taskCreationRequest.create.mock.calls[0]?.[0].data.requestHash;
    expect(state.tx.taskCreationRequest.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', key: KEY, requestHash },
    });
    expect(state.tx.taskDependency.createMany).toHaveBeenCalledWith({
      data: [{ taskId: task.id, dependsOnTaskId: 'task-dependency' }],
      skipDuplicates: true,
    });
    expect(state.tx.taskCreationRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { taskId: task.id },
    });
    expect(state.auditInTransaction).toHaveBeenCalledWith(
      state.tx,
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'project-1',
        taskId: task.id,
        summary: `Created ${task.key}: ${task.title}`,
      }),
    );

    state.findRequest.mockResolvedValue({
      id: 'request-1',
      organizationId: 'org-1',
      requestHash,
      taskId: task.id,
    });
    await expect(state.service.create('org-1', request, 'user-1', KEY)).resolves.toBe(task);

    expect(state.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(state.publish).toHaveBeenCalledTimes(1);
    expect(state.updateRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', taskId: task.id }),
        data: { replayCount: { increment: 1 }, lastReplayedAt: expect.any(Date) },
      }),
    );
    expect(state.auditInTransaction).toHaveBeenCalledTimes(2);
    expect(state.auditInTransaction.mock.calls[1]?.[0]).toBe(state.tx);
    expect(state.audit).not.toHaveBeenCalled();
    const replayAudit = state.auditInTransaction.mock.calls[1]?.[1];
    expect(replayAudit.metadata).toEqual({ idempotentReplay: true });
    expect(JSON.stringify(replayAudit)).not.toContain(KEY);
    expect(JSON.stringify(replayAudit)).not.toContain(requestHash);
  });

  it('returns the scoped concurrent winner after the idempotency unique constraint races', async () => {
    const state = makeService();
    let winningHash = '';
    state.findRequest.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
      id: 'winner-request',
      requestHash: winningHash,
      taskId: task.id,
    }));
    state.tx.taskCreationRequest.create.mockImplementationOnce(async ({ data }) => {
      winningHash = data.requestHash;
      throw uniqueViolation();
    });

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).resolves.toBe(task);

    expect(state.findRequest).toHaveBeenNthCalledWith(2, {
      where: { organizationId_key: { organizationId: 'org-1', key: KEY } },
    });
    expect(state.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.updateRequests).toHaveBeenCalledOnce();
    expect(state.auditInTransaction).toHaveBeenCalledWith(
      state.tx,
      expect.objectContaining({ metadata: { idempotentReplay: true } }),
    );
  });

  it('retries a task-key P2002 when there is no scoped idempotency winner', async () => {
    const state = makeService();
    state.tx.task.create.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce(task);

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).resolves.toBe(task);

    expect(state.findRequest).toHaveBeenCalledTimes(2);
    expect(state.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(state.tx.taskCreationRequest.create).toHaveBeenCalledTimes(2);
    expect(state.tx.task.create).toHaveBeenCalledTimes(2);
    expect(state.auditInTransaction).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('propagates non-unique transaction failures without retrying or publishing', async () => {
    const state = makeService();
    state.tx.task.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).rejects.toThrow(
      'database unavailable',
    );

    expect(state.prisma.$transaction).toHaveBeenCalledOnce();
    expect(state.findRequest).toHaveBeenCalledOnce();
    expect(state.auditInTransaction).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('rejects a reused key with a different normalized payload', async () => {
    const state = makeService();
    state.findRequest.mockResolvedValue({
      id: 'request-1',
      requestHash: 'hash-for-a-different-payload',
      taskId: task.id,
    });

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).rejects.toMatchObject({
      code: ApiErrorCode.TASK_IDEMPOTENCY_CONFLICT,
      status: 409,
    });
    expect(state.prisma.$transaction).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('scopes the same key independently by organization', async () => {
    const state = makeService();
    state.prisma.project.findFirst = vi.fn().mockResolvedValue({
      id: 'project-2',
      organizationId: 'org-2',
      maxTaskAttempts: 3,
    }) as never;
    const secondDto = { ...dto(), projectId: 'project-2' };

    await state.service.create('org-2', secondDto, 'user-2', KEY);

    expect(state.findRequest).toHaveBeenCalledWith({
      where: { organizationId_key: { organizationId: 'org-2', key: KEY } },
    });
    expect(state.tx.taskCreationRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-2', key: KEY }),
    });
  });

  it('keeps clients without an idempotency header compatible', async () => {
    const state = makeService();

    await expect(state.service.create('org-1', dto(), 'user-1')).resolves.toBe(task);

    expect(state.findRequest).not.toHaveBeenCalled();
    expect(state.tx.taskCreationRequest.create).not.toHaveBeenCalled();
    expect(state.auditInTransaction).toHaveBeenCalledWith(state.tx, expect.any(Object));
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('fails closed when a stored request has no owned task', async () => {
    const state = makeService();
    await state.service.create('org-1', dto(), 'user-1', KEY);
    const requestHash = state.tx.taskCreationRequest.create.mock.calls[0]?.[0].data.requestHash;
    state.findRequest.mockResolvedValue({ id: 'request-1', requestHash, taskId: task.id });
    state.prisma.task.findFirst = vi.fn().mockResolvedValue(null) as never;

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).rejects.toMatchObject({
      code: ApiErrorCode.INTERNAL_ERROR,
    });
    expect(state.updateRequests).not.toHaveBeenCalled();
  });

  it('rolls replay statistics back when the atomic replay audit fails', async () => {
    const state = makeService();
    await state.service.create('org-1', dto(), 'user-1', KEY);
    const requestHash = state.tx.taskCreationRequest.create.mock.calls[0]?.[0].data.requestHash;
    state.findRequest.mockResolvedValue({ id: 'request-1', requestHash, taskId: task.id });
    const auditFailure = new Error('audit unavailable');
    state.auditInTransaction.mockRejectedValueOnce(auditFailure);
    state.publish.mockClear();

    await expect(state.service.create('org-1', dto(), 'user-1', KEY)).rejects.toBe(auditFailure);

    expect(state.updateRequests).toHaveBeenCalledOnce();
    expect(state.auditInTransaction).toHaveBeenLastCalledWith(
      state.tx,
      expect.objectContaining({ metadata: { idempotentReplay: true } }),
    );
    expect(state.publish).not.toHaveBeenCalled();
  });
});
