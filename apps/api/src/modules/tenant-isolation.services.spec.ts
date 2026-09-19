import { AgentRunStatus, ApprovalStatus, FindingStatus, RunStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AgentRunsService } from './agent-runs/agent-runs.service';
import { ApprovalsService } from './approvals/approvals.service';
import { ArtifactsService } from './artifacts/artifacts.service';
import { ReviewsService } from './reviews/reviews.service';
import { TasksService } from './tasks/tasks.service';
import { TestsService } from './tests/tests.service';
import { WorkflowsService } from './workflows/workflows.service';

const resolveOperations = (operations: Array<Promise<unknown>>) => Promise.all(operations);

describe('tenant-isolated service reads', () => {
  it('scopes task lists and details through the project organization', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: vi.fn().mockImplementation(resolveOperations),
      task: { findMany, count, findFirst },
    } as unknown as PrismaService;
    const service = new TasksService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);

    await service.list('org-1', { page: 1, pageSize: 25, sortDir: 'desc' });
    await expect(service.findOne('org-1', 'foreign-task')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ project: { organizationId: 'org-1' } }),
      }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-task', project: { organizationId: 'org-1' } },
      }),
    );
  });

  it('scopes test-run lists and details through task ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: vi.fn().mockImplementation(resolveOperations),
      testRun: { findMany, count, findFirst },
    } as unknown as PrismaService;
    const service = new TestsService(prisma, {} as never);

    await service.list('org-1', 1, 25, 'project-1');
    await expect(service.findOne('org-1', 'foreign-test')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ AND: expect.any(Array) }),
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'foreign-test', AND: expect.any(Array) }),
      }),
    );
  });

  it('scopes review runs and findings through task ownership', async () => {
    const reviewFindMany = vi.fn().mockResolvedValue([]);
    const reviewCount = vi.fn().mockResolvedValue(0);
    const findingFindMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValueOnce([{ total: BigInt(0) }]).mockResolvedValueOnce([]);
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: queryRaw,
      reviewRun: { findMany: reviewFindMany, count: reviewCount },
      reviewFinding: { findMany: findingFindMany },
    };
    prisma.$transaction.mockImplementation(
      (operations: Array<Promise<unknown>> | ((tx: typeof prisma) => Promise<unknown>)) =>
        typeof operations === 'function' ? operations(prisma) : resolveOperations(operations),
    );
    const service = new ReviewsService(prisma as unknown as PrismaService, {} as never);

    await service.list('org-1', 1, 25, { projectId: 'project-1' });
    await service.listFindings('org-1', 1, 25, { projectId: 'project-1' });

    expect(reviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
      }),
    );
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(findingFindMany).not.toHaveBeenCalled();
  });

  it('scopes agent runs through an owned task or workflow project', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: vi.fn().mockImplementation(resolveOperations),
      agentRun: { findMany, count },
    } as unknown as PrismaService;
    const service = new AgentRunsService(prisma, {} as never, {} as never);

    await service.list('org-1', { page: 1, pageSize: 25, sortDir: 'desc' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { taskId: { not: null } },
                { workflowRunId: { not: null } },
                { workflowStepId: { not: null } },
              ],
            },
            { OR: [{ taskId: null }, { task: { project: { organizationId: 'org-1' } } }] },
            {
              OR: [
                { workflowRunId: null },
                { workflowRun: { project: { organizationId: 'org-1' } } },
              ],
            },
          ]),
        }),
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ AND: expect.any(Array) }),
    });
  });

  it('scopes workflow runs and approvals through their project organization', async () => {
    const workflowFindMany = vi.fn().mockResolvedValue([]);
    const workflowCount = vi.fn().mockResolvedValue(0);
    const approvalFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: vi.fn().mockImplementation(resolveOperations),
      workflowRun: { findMany: workflowFindMany, count: workflowCount },
      approval: { findMany: approvalFindMany },
    } as unknown as PrismaService;

    await new WorkflowsService(prisma, { name: 'test' } as never, {} as never, {} as never).listRuns('org-1', {
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
    });
    await new ApprovalsService(prisma, {} as never).list('org-1', {});

    expect(workflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ project: { organizationId: 'org-1' } }]),
        }),
      }),
    );
    expect(approvalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ project: { organizationId: 'org-1' } }]),
        }),
      }),
    );
  });

  it('scopes artifacts through every supported owning relation', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { artifact: { findMany } } as unknown as PrismaService;
    const service = new ArtifactsService(prisma);

    await service.list('org-1', {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { taskId: { not: null } },
                { agentRunId: { not: null } },
                { testRunId: { not: null } },
              ],
            },
            { OR: [{ taskId: null }, { task: { project: { organizationId: 'org-1' } } }] },
          ]),
        }),
      }),
    );
  });
});

describe('tenant-isolated service side effects', () => {
  it('does not create or enqueue a test run for a foreign task', async () => {
    const create = vi.fn();
    const enqueue = vi.fn();
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(null) },
      testRun: { create },
    } as unknown as PrismaService;
    const service = new TestsService(prisma, { enqueue } as never);

    await expect(service.trigger('org-1', 'foreign-task', [])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not create or enqueue a review for a foreign task', async () => {
    const create = vi.fn();
    const enqueue = vi.fn();
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(null) },
      reviewRun: { create },
    } as unknown as PrismaService;
    const service = new ReviewsService(prisma, { enqueue } as never);

    await expect(service.trigger('org-1', 'foreign-task', 'CODE')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not update a foreign review finding', async () => {
    const update = vi.fn();
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      reviewFinding: { findFirst: vi.fn().mockResolvedValue(null), update },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const service = new ReviewsService(prisma as unknown as PrismaService, {} as never);

    await expect(
      service.updateFinding('org-1', 'foreign-finding', FindingStatus.RESOLVED),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not stop, update, or audit a foreign agent run', async () => {
    const enqueue = vi.fn();
    const update = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      agentRun: { findFirst: vi.fn().mockResolvedValue(null), update },
    } as unknown as PrismaService;
    const service = new AgentRunsService(prisma, { enqueue } as never, { recordSafe } as never);

    await expect(service.cancel('org-1', 'foreign-run', 'stop')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });

  it('does not cancel a foreign workflow run', async () => {
    const cancel = vi.fn();
    const prisma = {
      workflowRun: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new WorkflowsService(prisma, { name: 'test', cancel } as never, {} as never, {} as never);

    await expect(service.cancel('org-1', 'foreign-workflow', 'stop')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not decide or audit a foreign approval', async () => {
    const update = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      approval: { findFirst: vi.fn().mockResolvedValue(null), update },
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma, { recordSafe } as never);

    await expect(
      service.decide('org-1', 'foreign-approval', 'APPROVED', undefined, 'user-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });

  it('queries the owned approval before applying the existing decision flow', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi
      .fn()
      .mockResolvedValue({ id: 'approval-1', status: ApprovalStatus.APPROVED });
    const recordSafe = vi.fn().mockResolvedValue(undefined);
    const findFirst = vi.fn().mockResolvedValue({
      id: 'approval-1',
      projectId: 'project-1',
      taskId: null,
      kind: 'IMPLEMENTATION',
      status: ApprovalStatus.PENDING,
      project: { organizationId: 'org-1' },
      task: null,
      workflowRun: null,
    });
    const prisma = {
      approval: { findFirst, updateMany, findUniqueOrThrow },
    } as unknown as PrismaService;
    const service = new ApprovalsService(prisma, { recordSafe } as never);

    await service.decide('org-1', 'approval-1', 'APPROVED', undefined, 'user-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-1',
          AND: expect.arrayContaining([{ project: { organizationId: 'org-1' } }]),
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'approval-1', status: ApprovalStatus.PENDING } }),
    );
    expect(recordSafe).toHaveBeenCalledOnce();
  });

  it('does not query screenshots after foreign task ownership fails', async () => {
    const screenshotFindMany = vi.fn();
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(null) },
      screenshot: { findMany: screenshotFindMany },
    } as unknown as PrismaService;
    const service = new ArtifactsService(prisma);

    await expect(service.screenshots('org-1', 'foreign-task')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(screenshotFindMany).not.toHaveBeenCalled();
  });

  it('uses an ownership query before returning an inactive agent run without side effects', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'agent-run-1',
      status: AgentRunStatus.SUCCEEDED,
      task: null,
    });
    const enqueue = vi.fn();
    const update = vi.fn();
    const prisma = { agentRun: { findFirst, update } } as unknown as PrismaService;
    const service = new AgentRunsService(prisma, { enqueue } as never, {} as never);

    await service.cancel('org-1', 'agent-run-1', 'stop');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'agent-run-1' }),
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('uses project ownership when fetching workflow details', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { workflowRun: { findFirst } } as unknown as PrismaService;
    const service = new WorkflowsService(prisma, { name: 'test' } as never, {} as never, {} as never);

    await expect(service.findOne('org-1', 'foreign-workflow')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'foreign-workflow',
          AND: expect.arrayContaining([{ project: { organizationId: 'org-1' } }]),
        }),
      }),
    );
  });

  it('keeps status filters while adding workflow ownership', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: vi.fn().mockImplementation(resolveOperations),
      workflowRun: { findMany, count },
    } as unknown as PrismaService;
    const service = new WorkflowsService(prisma, { name: 'test' } as never, {} as never, {} as never);

    await service.listRuns('org-1', {
      page: 1,
      pageSize: 25,
      status: RunStatus.RUNNING,
      sortDir: 'desc',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ project: { organizationId: 'org-1' } }]),
          status: RunStatus.RUNNING,
        }),
      }),
    );
  });
});
