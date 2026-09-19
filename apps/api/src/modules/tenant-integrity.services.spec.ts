import { AgentRunStatus, ApprovalStatus, RunStatus, TaskStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  ownedAgentRunWhere,
  ownedArtifactWhere,
  ownedFindingSql,
} from '../common/tenant-ownership';
import { AgentRunsService } from './agent-runs/agent-runs.service';
import { ApprovalsService } from './approvals/approvals.service';
import { ArtifactsService } from './artifacts/artifacts.service';
import { ReviewsService } from './reviews/reviews.service';
import { TasksService } from './tasks/tasks.service';
import { TestsService } from './tests/tests.service';
import { WorkflowsService } from './workflows/workflows.service';

describe('fail-closed multi-owner filters', () => {
  it('rejects a cross-linked global finding task while preserving nullable task ownership', () => {
    const scope = ownedFindingSql('org-1');
    const sql = scope.strings.join(' ');
    expect(sql).toContain('f."taskId" IS NULL OR f."taskId" = r."taskId"');
    expect(sql).toContain('s."taskId" IS NULL OR s."taskId" = r."taskId"');

    const eligible = (findingTaskId: string | null, reviewTaskId: string) =>
      findingTaskId === null || findingTaskId === reviewTaskId;
    expect(eligible('foreign-task', 'owned-task')).toBe(false);
    expect(eligible('owned-task', 'owned-task')).toBe(true);
    expect(eligible(null, 'owned-task')).toBe(true);
  });

  it('requires at least one agent-run owner and validates task, workflow, and step owners', () => {
    const where = ownedAgentRunWhere('org-1', 'project-1');

    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { taskId: { not: null } },
            { workflowRunId: { not: null } },
            { workflowStepId: { not: null } },
          ],
        },
        {
          OR: [
            { taskId: null },
            { task: { project: { organizationId: 'org-1', id: 'project-1' } } },
          ],
        },
        {
          OR: [
            { workflowRunId: null },
            { workflowRun: { project: { organizationId: 'org-1', id: 'project-1' } } },
          ],
        },
        {
          OR: [
            { workflowStepId: null },
            {
              workflowStep: {
                workflowRun: { project: { organizationId: 'org-1', id: 'project-1' } },
              },
            },
          ],
        },
        {
          OR: [
            { agentId: null },
            {
              agent: {
                organizationId: 'org-1',
                provider: { organizationId: 'org-1' },
                OR: [{ projectId: null }, { projectId: 'project-1' }],
              },
            },
          ],
        },
        {
          OR: [{ providerId: null }, { provider: { organizationId: 'org-1' } }],
        },
      ]),
    );
  });

  it('supports workflow-only and step-only agent runs without allowing ownerless rows', () => {
    const where = ownedAgentRunWhere('org-1');
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { taskId: { not: null } },
            { workflowRunId: { not: null } },
            { workflowStepId: { not: null } },
          ],
        },
        expect.objectContaining({ OR: expect.arrayContaining([{ taskId: null }]) }),
        expect.objectContaining({ OR: expect.arrayContaining([{ workflowRunId: null }]) }),
        expect.objectContaining({ OR: expect.arrayContaining([{ workflowStepId: null }]) }),
      ]),
    );
  });

  it('requires every populated artifact owner, preventing either cross-link direction', () => {
    const where = ownedArtifactWhere('org-1');
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ taskId: null }, { task: { project: { organizationId: 'org-1' } } }] },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { agentRunId: null },
            expect.objectContaining({ agentRun: expect.objectContaining({ AND: expect.any(Array) }) }),
          ]),
        }),
        {
          OR: [
            { testRunId: null },
            { testRun: { task: { project: { organizationId: 'org-1' } } } },
          ],
        },
      ]),
    );
  });
});

describe('nested artifact and screenshot isolation', () => {
  it('filters artifacts nested under both test-run and agent-run detail responses', async () => {
    const testFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'test-1', task: { projectId: 'project-1' } })
      .mockResolvedValueOnce({ id: 'test-1', artifacts: [] });
    const agentFindFirst = vi
      .fn()
      .mockResolvedValueOnce({
        task: { projectId: 'project-1' },
        workflowRun: null,
        workflowStep: null,
      })
      .mockResolvedValueOnce({ id: 'agent-1', artifacts: [] });
    const prisma = {
      testRun: { findFirst: testFindFirst },
      agentRun: { findFirst: agentFindFirst },
    } as unknown as PrismaService;

    await new TestsService(prisma, {} as never).findOne('org-1', 'test-1');
    await new AgentRunsService(prisma, {} as never, {} as never).findOne('org-1', 'agent-1');

    expect(testFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          artifacts: { where: expect.objectContaining({ AND: expect.any(Array) }) },
        }),
      }),
    );
    expect(agentFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          artifacts: { where: expect.objectContaining({ AND: expect.any(Array) }) },
        }),
      }),
    );
  });

  it('requires screenshot review ownership, task agreement, and scoped nested findings', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue({ id: 'task-1' }) },
      screenshot: { findMany },
    } as unknown as PrismaService;

    await new ArtifactsService(prisma).screenshots('org-1', 'task-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task-1',
          OR: [
            { reviewRunId: null },
            {
              reviewRun: {
                taskId: 'task-1',
                task: { project: { organizationId: 'org-1' } },
              },
            },
          ],
        },
        include: {
          findings: {
            where: expect.objectContaining({
              OR: [{ taskId: null }, { taskId: 'task-1' }],
              reviewRun: {
                taskId: 'task-1',
                task: { project: { organizationId: 'org-1' } },
              },
            }),
          },
        },
      }),
    );
  });
});

describe('aggregate endpoint isolation', () => {
  it('scopes every task-detail aggregate to the owned project', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'task-1', projectId: 'project-1' })
      .mockResolvedValueOnce({ id: 'task-1', status: TaskStatus.BACKLOG });
    const prisma = { task: { findFirst } } as unknown as PrismaService;
    const service = new TasksService(
      prisma,
      {} as never,
      {} as never,
      { allowedNext: vi.fn().mockReturnValue([]) } as never,
      {} as never,
      {} as never,
    );

    await service.findOne('org-1', 'task-1');

    const include = findFirst.mock.calls[1]?.[0].include;
    for (const key of [
      'workflowRuns',
      'agentRuns',
      'testRuns',
      'reviewRuns',
      'artifacts',
      'approvals',
    ]) {
      expect(include[key].where).toEqual(expect.objectContaining({ AND: expect.any(Array) }));
    }
    expect(include.reviewRuns.include.findings.where).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );
  });

  it('scopes workflow-step runs and findings to the workflow project and task', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'workflow-1',
        projectId: 'project-1',
        taskId: 'task-1',
        task: { projectId: 'project-1' },
      })
      .mockResolvedValueOnce({
        id: 'workflow-1',
        definitionKey: 'engineering-task',
        steps: [],
      });
    const prisma = { workflowRun: { findFirst } } as unknown as PrismaService;

    await new WorkflowsService(prisma, { name: 'test' } as never, {} as never, {} as never).findOne(
      'org-1',
      'workflow-1',
    );

    const stepInclude = findFirst.mock.calls[1]?.[0].include.steps.include;
    expect(stepInclude.agentRuns.where).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );
    expect(stepInclude.testRuns.where).toEqual(
      expect.objectContaining({ taskId: 'task-1', AND: expect.any(Array) }),
    );
    expect(stepInclude.reviewRuns.where).toEqual(
      expect.objectContaining({ taskId: 'task-1', AND: expect.any(Array) }),
    );
    expect(stepInclude.reviewRuns.include.findings.where).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );
  });

  it('scopes review-list findings and review-detail screenshots to the owned task', async () => {
    const reviewFindFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'review-1',
        taskId: 'task-1',
        task: { projectId: 'project-1' },
      })
      .mockResolvedValueOnce({ id: 'review-1' });
    const reviewFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      task: {
        findFirst: vi.fn().mockResolvedValue({ id: 'task-1', projectId: 'project-1' }),
      },
      reviewRun: { findFirst: reviewFindFirst, findMany: reviewFindMany },
    } as unknown as PrismaService;
    const service = new ReviewsService(prisma, {} as never);

    await service.listForTask('org-1', 'task-1');
    await service.findOne('org-1', 'review-1');

    expect(reviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
        include: expect.objectContaining({
          findings: expect.objectContaining({
            where: expect.objectContaining({ AND: expect.any(Array) }),
          }),
        }),
      }),
    );
    const detailInclude = reviewFindFirst.mock.calls[1]?.[0].include;
    expect(detailInclude.findings.where).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );
    expect(detailInclude.screenshots.where).toEqual(
      expect.objectContaining({ AND: expect.any(Array) }),
    );
  });
});

describe('cross-linked approval and workflow rejection', () => {
  it.each([
    {
      name: 'task points at another project',
      task: { projectId: 'project-2' },
      workflowRun: null,
    },
    {
      name: 'workflow points at another project',
      task: null,
      workflowRun: { projectId: 'project-2', task: null },
    },
    {
      name: 'workflow task points at another project',
      task: null,
      workflowRun: {
        projectId: 'project-1',
        task: { projectId: 'project-2', project: { organizationId: 'org-1' } },
      },
    },
  ])('does not decide when $name', async ({ task, workflowRun }) => {
    const updateMany = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      approval: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'approval-1',
          projectId: 'project-1',
          taskId: task ? 'task-1' : null,
          kind: 'IMPLEMENTATION',
          status: ApprovalStatus.PENDING,
          project: { organizationId: 'org-1' },
          task,
          workflowRun,
        }),
        updateMany,
      },
    } as unknown as PrismaService;

    await expect(
      new ApprovalsService(prisma, { recordSafe } as never).decide(
        'org-1',
        'approval-1',
        'APPROVED',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });

  it('lets only the atomic approval winner audit and return', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const recordSafe = vi.fn();
    const findUniqueOrThrow = vi.fn();
    const prisma = {
      approval: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'approval-1',
          projectId: 'project-1',
          taskId: null,
          kind: 'IMPLEMENTATION',
          status: ApprovalStatus.PENDING,
          project: { organizationId: 'org-1' },
          task: null,
          workflowRun: null,
        }),
        updateMany,
        findUniqueOrThrow,
      },
    } as unknown as PrismaService;

    await expect(
      new ApprovalsService(prisma, { recordSafe } as never).decide(
        'org-1',
        'approval-1',
        'APPROVED',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(recordSafe).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('does not cancel a cross-project workflow run', async () => {
    const cancel = vi.fn();
    const prisma = {
      workflowRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow-1',
          projectId: 'project-1',
          task: { projectId: 'project-2' },
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new WorkflowsService(prisma, { name: 'test', cancel } as never, {} as never, {} as never).cancel(
        'org-1',
        'workflow-1',
        'stop',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED])(
    'does not enqueue cancellation for terminal workflow status %s',
    async (status) => {
      const cancel = vi.fn();
      const prisma = {
        workflowRun: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'workflow-1',
            projectId: 'project-1',
            task: { projectId: 'project-1' },
            status,
          }),
        },
      } as unknown as PrismaService;

      await expect(
        new WorkflowsService(prisma, { name: 'test', cancel } as never, {} as never, {} as never).cancel(
          'org-1',
          'workflow-1',
          'stop',
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(cancel).not.toHaveBeenCalled();
    },
  );
});

describe('atomic agent cancellation', () => {
  const baseRun = {
    id: 'agent-1',
    status: AgentRunStatus.RUNNING,
    role: 'IMPLEMENTER',
    providerKey: 'codex',
    taskId: null,
    task: null,
  };

  it.each([
    {
      name: 'workflow-only',
      workflowRun: { projectId: 'project-1', project: { organizationId: 'org-1' } },
      workflowStep: null,
    },
    {
      name: 'step-only',
      workflowRun: null,
      workflowStep: {
        workflowRun: { projectId: 'project-1', project: { organizationId: 'org-1' } },
      },
    },
  ])('audits a $name run with its canonical project', async ({ workflowRun, workflowStep }) => {
    const enqueue = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({ ...baseRun, workflowRun, workflowStep }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([{
          ...baseRun, status: AgentRunStatus.CANCELLED, workflowRun, workflowStep,
        }]),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...baseRun,
          status: AgentRunStatus.CANCELLED,
        }),
      },
    } as unknown as PrismaService;

    await new AgentRunsService(prisma, { enqueue } as never, { recordSafe } as never).cancel(
      'org-1',
      'agent-1',
      'stop',
    );

    expect(enqueue).toHaveBeenCalledOnce();
    expect(recordSafe).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', projectId: 'project-1' }),
    );
  });

  it('does not enqueue or audit when completion wins the cancellation race', async () => {
    const enqueue = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({
          ...baseRun,
          workflowRun: { projectId: 'project-1', project: { organizationId: 'org-1' } },
          workflowStep: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    await expect(
      new AgentRunsService(prisma, { enqueue } as never, { recordSafe } as never).cancel(
        'org-1',
        'agent-1',
        'stop',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });

  it('keeps cancellation committed and audits when cancellation enqueue fails', async () => {
    const enqueueError = new Error('redis unavailable');
    const enqueue = vi.fn().mockRejectedValue(enqueueError);
    const recordSafe = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      agentRun: {
        findFirst: vi.fn().mockResolvedValue({
          ...baseRun,
          completedAt: null,
          errorMessage: null,
          workflowRun: { projectId: 'project-1', project: { organizationId: 'org-1' } },
          workflowStep: null,
        }),
        updateMany,
        findMany: vi.fn().mockResolvedValue([{
          ...baseRun,
          status: AgentRunStatus.CANCELLED,
          workflowRun: { projectId: 'project-1' },
          workflowStep: null,
        }]),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...baseRun,
          status: AgentRunStatus.CANCELLED,
          errorMessage: 'stop',
        }),
      },
    } as unknown as PrismaService;

    await expect(
      new AgentRunsService(prisma, { enqueue } as never, { recordSafe } as never).cancel(
        'org-1',
        'agent-1',
        'stop',
      ),
    ).resolves.toMatchObject({ id: 'agent-1', status: AgentRunStatus.CANCELLED });

    expect(updateMany).toHaveBeenCalledOnce();
    expect(recordSafe).toHaveBeenCalledOnce();
  });
});

describe('task mutation ownership and retry safety', () => {
  const makeService = (findFirst: ReturnType<typeof vi.fn>) => {
    const effects = {
      taskUpdate: vi.fn(),
      taskUpdateMany: vi.fn(),
      workflowCreate: vi.fn(),
      commentCreate: vi.fn(),
      dependencyCreate: vi.fn(),
      approvalCreate: vi.fn(),
      transition: vi.fn(),
      transitionThrough: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      publish: vi.fn(),
      audit: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
          task: { findFirst },
          workflowRun: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: effects.workflowCreate,
          },
        }),
      ),
      task: { findFirst, update: effects.taskUpdate, updateMany: effects.taskUpdateMany },
      workflowRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        create: effects.workflowCreate,
      },
      taskComment: { create: effects.commentCreate },
      taskDependency: { create: effects.dependencyCreate },
      approval: { create: effects.approvalCreate },
    } as unknown as PrismaService;
    const service = new TasksService(
      prisma,
      { publish: effects.publish } as never,
      { recordSafe: effects.audit } as never,
      {
        transition: effects.transition,
        transitionThrough: effects.transitionThrough,
        cancelWithWorkflows: vi.fn().mockRejectedValue({ code: 'NOT_FOUND' }),
      } as never,
      { start: effects.start, cancel: effects.cancel } as never,
      { cancelActiveForTask: vi.fn() } as never,
    );
    return { service, effects };
  };

  it('rejects every foreign-organization task mutation before side effects', async () => {
    const { service, effects } = makeService(vi.fn().mockResolvedValue(null));
    const calls: Array<() => Promise<unknown>> = [
      () => service.update('org-1', 'foreign', { title: 'x' } as never),
      () => service.transition('org-1', 'foreign', TaskStatus.QUEUED),
      () => service.plan('org-1', 'foreign', {} as never),
      () => service.run('org-1', 'foreign', {} as never),
      () => service.cancel('org-1', 'foreign', 'stop'),
      () => service.retry('org-1', 'foreign', true),
      () => service.approve('org-1', 'foreign', undefined, false),
      () => service.addComment('org-1', 'foreign', 'comment'),
      () => service.addDependency('org-1', 'foreign', 'dependency', 'BLOCKS'),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }

    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELLED])(
    'does not reset or run a terminal %s task',
    async (status) => {
      const { service, effects } = makeService(
        vi.fn().mockResolvedValue({ id: 'task-1', key: 'ENG-1', status }),
      );

      await expect(service.retry('org-1', 'task-1', true)).rejects.toMatchObject({
        code: 'TASK_INVALID_TRANSITION',
      });
      expect(effects.taskUpdate).not.toHaveBeenCalled();
      expect(effects.taskUpdateMany).not.toHaveBeenCalled();
      expect(effects.transitionThrough).not.toHaveBeenCalled();
      expect(effects.workflowCreate).not.toHaveBeenCalled();
      expect(effects.start).not.toHaveBeenCalled();
    },
  );

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELLED])(
    'does not start a workflow from terminal %s even when forced',
    async (status) => {
      const { service, effects } = makeService(
        vi.fn().mockResolvedValue({ id: 'task-1', key: 'ENG-1', status }),
      );
      await expect(service.run('org-1', 'task-1', {
        workflowKey: 'engineering-task', skipPlanning: false, force: true,
      } as never)).rejects.toMatchObject({ code: 'TASK_INVALID_TRANSITION' });
      expect(effects.workflowCreate).not.toHaveBeenCalled();
      expect(effects.start).not.toHaveBeenCalled();
    },
  );

  it.each([
    TaskStatus.BACKLOG,
    TaskStatus.PLAN_READY,
    TaskStatus.QUEUED,
    TaskStatus.PLANNING,
    TaskStatus.IMPLEMENTING,
    TaskStatus.TESTING,
    TaskStatus.REVIEWING,
    TaskStatus.APPROVED,
    TaskStatus.PR_READY,
    TaskStatus.PR_CREATED,
  ])('does not retry non-failure status %s', async (status) => {
    const { service, effects } = makeService(
      vi.fn().mockResolvedValue({ id: 'task-1', key: 'ENG-1', status }),
    );

    await expect(service.retry('org-1', 'task-1', true)).rejects.toMatchObject({
      code: 'TASK_INVALID_TRANSITION',
    });
    expect(effects.taskUpdateMany).not.toHaveBeenCalled();
    expect(effects.transitionThrough).not.toHaveBeenCalled();
    expect(effects.workflowCreate).not.toHaveBeenCalled();
    expect(effects.start).not.toHaveBeenCalled();
  });

  it('rejects an active run before retry reset or orchestration', async () => {
    const { service, effects } = makeService(
      vi.fn().mockResolvedValue({
        id: 'task-1',
        key: 'ENG-1',
        projectId: 'project-1',
        status: TaskStatus.FAILED,
      }),
    );
    const workflowFindFirst = (
      service as unknown as {
        prisma: { workflowRun: { findFirst: ReturnType<typeof vi.fn> } };
      }
    ).prisma.workflowRun.findFirst;
    workflowFindFirst.mockResolvedValue({ id: 'active-workflow' });

    await expect(service.retry('org-1', 'task-1', true)).rejects.toMatchObject({
      code: 'TASK_ALREADY_RUNNING',
    });
    expect(effects.taskUpdateMany).not.toHaveBeenCalled();
    expect(effects.transitionThrough).not.toHaveBeenCalled();
    expect(effects.workflowCreate).not.toHaveBeenCalled();
    expect(effects.start).not.toHaveBeenCalled();
  });

  it('creates a workflow using the owned task project for both persisted and queued input', async () => {
    const { service, effects } = makeService(
      vi.fn().mockResolvedValue({
        id: 'task-1',
        key: 'ENG-1',
        projectId: 'project-1',
        description: 'do work',
        attemptCount: 0,
        maxAttempts: 3,
        project: {
          id: 'project-1',
          organizationId: 'org-1',
          maxReviewCycles: 2,
          maxTaskAttempts: 3,
          permissionLevel: 'LEVEL_2_CODE',
        },
      }),
    );
    effects.workflowCreate.mockResolvedValue({ id: 'workflow-1' });

    await service.run('org-1', 'task-1', {
      workflowKey: 'engineering-task',
      skipPlanning: false,
      force: false,
    } as never);

    expect(effects.workflowCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'project-1', taskId: 'task-1' }),
      }),
    );
    expect(effects.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'workflow-1',
        projectId: 'project-1',
        taskId: 'task-1',
        organizationId: 'org-1',
      }),
    );
  });

  it('serializes non-force starts for one task while force may start another run', async () => {
    const task = {
      id: 'task-1', key: 'ENG-1', projectId: 'project-1', description: 'do work',
      attemptCount: 0, maxAttempts: 3,
      project: {
        id: 'project-1', organizationId: 'org-1', maxReviewCycles: 2,
        maxTaskAttempts: 3, permissionLevel: 'LEVEL_2_CODE',
      },
    };
    let active: { id: string } | null = null;
    let releasePrevious = Promise.resolve();
    const create = vi.fn().mockImplementation(async () => {
      active = { id: `workflow-${String(create.mock.calls.length)}` };
      return active;
    });
    const lock = vi.fn().mockResolvedValue([{ id: 'task-1' }]);
    const tx = {
      $queryRaw: lock,
      task: { findFirst: vi.fn().mockResolvedValue(task) },
      workflowRun: { findFirst: vi.fn().mockImplementation(async () => active), create },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const previous = releasePrevious;
        let release!: () => void;
        releasePrevious = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try { return await callback(tx); } finally { release(); }
      }),
      workflowRun: { updateMany: vi.fn() },
    } as unknown as PrismaService;
    const start = vi.fn();
    const service = new TasksService(
      prisma, { publish: vi.fn() } as never, {} as never, {} as never,
      { start } as never, {} as never,
    );
    const request = { workflowKey: 'engineering-task', skipPlanning: false, force: false };

    const results = await Promise.allSettled([
      service.run('org-1', 'task-1', request),
      service.run('org-1', 'task-1', request),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'TASK_ALREADY_RUNNING' } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledTimes(2);

    await service.run('org-1', 'task-1', { ...request, force: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('commits task and every sibling workflow cancellation before signaling their agents', async () => {
    const signal = vi.fn();
    const cancelAgent = vi.fn();
    const cancelWithWorkflows = vi.fn().mockResolvedValue({
      task: { id: 'task-1', status: TaskStatus.CANCELLED },
      workflowRunIds: ['workflow-1', 'workflow-2'],
      agentRunIds: ['agent-1', 'agent-2'],
    });
    const prisma = {
      workflowRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow-1', projectId: 'project-1', taskId: 'task-1',
          task: { projectId: 'project-1' }, status: RunStatus.RUNNING,
        }),
      },
    } as unknown as PrismaService;
    const service = new WorkflowsService(
      prisma, { cancel: signal } as never,
      { notifyCommittedCancellations: cancelAgent } as never,
      { cancelWithWorkflows } as never,
    );

    await service.cancel('org-1', 'workflow-1', 'stop');
    expect(cancelWithWorkflows).toHaveBeenCalledWith('org-1', 'task-1', 'stop', 'workflow-1');
    expect(cancelWithWorkflows.mock.invocationCallOrder[0]).toBeLessThan(signal.mock.invocationCallOrder[0]!);
    expect(cancelAgent).toHaveBeenCalledWith('org-1', ['agent-1', 'agent-2'], 'stop', true);
    expect(signal).toHaveBeenCalledWith('workflow-1', 'stop');
    expect(signal).toHaveBeenCalledWith('workflow-2', 'stop');
  });

  it('returns committed cancellation when queue and agent cleanup fail', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    const cancelActiveForTask = vi.fn().mockRejectedValue(new Error('agent queue unavailable'));
    const committedTask = { id: 'task-1', projectId: 'project-1', status: TaskStatus.CANCELLED };
    const cancelWithWorkflows = vi.fn().mockResolvedValue({
      task: committedTask, workflowRunIds: ['workflow-1'], agentRunIds: ['agent-1'],
    });
    const service = new TasksService(
      {} as never, {} as never, {} as never,
      { cancelWithWorkflows } as never,
      { cancel } as never,
      { notifyCommittedCancellations: cancelActiveForTask } as never,
    );

    await expect(service.cancel('org-1', 'task-1', 'stop')).resolves.toEqual({
      task: committedTask, cancelledRuns: ['workflow-1'],
    });
    expect(cancelWithWorkflows).toHaveBeenCalledWith('org-1', 'task-1', 'stop');
    expect(cancel).toHaveBeenCalledWith('workflow-1', 'stop');
    expect(cancelActiveForTask).toHaveBeenCalledWith('org-1', ['agent-1'], 'stop', true);
  });

  it('keeps workflow cancellation committed when cleanup signals fail', async () => {
    const cancelWithWorkflows = vi.fn().mockResolvedValue({
      task: { id: 'task-1', status: TaskStatus.CANCELLED },
      workflowRunIds: ['workflow-1'], agentRunIds: ['agent-1'],
    });
    const cancel = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    const cancelActiveForWorkflow = vi.fn().mockRejectedValue(new Error('agent queue unavailable'));
    const prisma = {
      workflowRun: { findFirst: vi.fn().mockResolvedValue({
        id: 'workflow-1', projectId: 'project-1', taskId: 'task-1',
        task: { projectId: 'project-1' }, status: RunStatus.RUNNING,
      }) },
    } as unknown as PrismaService;
    const service = new WorkflowsService(
      prisma, { cancel } as never,
      { notifyCommittedCancellations: cancelActiveForWorkflow } as never,
      { cancelWithWorkflows } as never,
    );

    await expect(service.cancel('org-1', 'workflow-1', 'stop')).resolves.toMatchObject({
      workflowRunId: 'workflow-1', requested: true,
    });
    expect(cancelWithWorkflows).toHaveBeenCalledWith('org-1', 'task-1', 'stop', 'workflow-1');
    expect(cancel).toHaveBeenCalledWith('workflow-1', 'stop');
    expect(cancelActiveForWorkflow).toHaveBeenCalledWith('org-1', ['agent-1'], 'stop', true);
  });

  it('rejects task creation for a foreign project before writes, events, or audit', async () => {
    const create = vi.fn();
    const publish = vi.fn();
    const recordSafe = vi.fn();
    const prisma = {
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      task: { create },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    const service = new TasksService(
      prisma,
      { publish } as never,
      { recordSafe } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.create('org-1', { projectId: 'foreign-project' } as never)).rejects
      .toMatchObject({ code: 'NOT_FOUND' });
    expect(create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(recordSafe).not.toHaveBeenCalled();
  });
});
