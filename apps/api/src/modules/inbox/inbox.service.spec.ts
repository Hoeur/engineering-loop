import { ApprovalStatus, FindingStatus, RunStatus, Severity, TaskStatus } from '@engloop/types';
import { inboxItemType } from '@engloop/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InboxService } from './inbox.service';

const resolveOperations = (operations: Array<Promise<unknown>>) => Promise.all(operations);

const AT = new Date('2026-09-01T10:00:00.000Z');

const project = { id: 'project-1', name: 'EngLoop' };

/**
 * Builds a Prisma double whose four source queries return whatever the test
 * supplies. Every call is recorded so the isolation tests can assert on the
 * `where` clause each source was queried with.
 */
const harness = (sources: {
  approvals?: unknown[];
  tasks?: unknown[];
  runs?: unknown[];
  findings?: unknown[];
}) => {
  const approvalFindMany = vi.fn().mockResolvedValue(sources.approvals ?? []);
  const taskFindMany = vi.fn().mockResolvedValue(sources.tasks ?? []);
  const runFindMany = vi.fn().mockResolvedValue(sources.runs ?? []);
  const findingFindMany = vi.fn().mockResolvedValue(sources.findings ?? []);

  const prisma = {
    $transaction: vi.fn().mockImplementation(resolveOperations),
    approval: { findMany: approvalFindMany },
    task: { findMany: taskFindMany },
    workflowRun: { findMany: runFindMany },
    reviewFinding: { findMany: findingFindMany },
  } as unknown as PrismaService;

  return {
    service: new InboxService(prisma),
    approvalFindMany,
    taskFindMany,
    runFindMany,
    findingFindMany,
  };
};

describe('InboxService aggregation', () => {
  it('returns items from all four sources', async () => {
    const { service } = harness({
      approvals: [
        {
          id: 'approval-1',
          kind: 'PLAN',
          reason: 'Plan needs sign-off',
          taskId: 'task-1',
          createdAt: AT,
          project,
          task: { key: 'ENG-1' },
        },
      ],
      tasks: [
        {
          id: 'task-2',
          key: 'ENG-2',
          title: 'Broken task',
          updatedAt: AT,
          project,
        },
      ],
      runs: [
        {
          id: 'run-1',
          error: 'Step failed',
          updatedAt: AT,
          project,
          task: { key: 'ENG-3', title: 'Failing run' },
        },
      ],
      findings: [
        {
          id: 'finding-1',
          severity: Severity.CRITICAL,
          problem: 'SQL injection',
          requiredFix: 'Parameterise the query',
          createdAt: AT,
          reviewRun: { taskId: 'task-4', task: { key: 'ENG-4', projectId: 'project-1', project } },
        },
      ],
    });

    const { items } = await service.list('org-1', {});

    expect(items.map((item) => item.type).sort()).toEqual(
      [
        inboxItemType.APPROVAL,
        inboxItemType.BLOCKING_FINDING,
        inboxItemType.HUMAN_REVIEW,
        inboxItemType.WORKFLOW_FAILURE,
      ].sort(),
    );
    expect(items.every((item) => item.projectId === 'project-1')).toBe(true);
    expect(items.every((item) => item.deepLink.startsWith('/'))).toBe(true);
  });

  it('derives firstSeenAt from the source record, not the query time', async () => {
    // If this regressed to Date.now(), every item would look brand new on each
    // poll and SLA age would be permanently zero.
    const { service } = harness({
      tasks: [{ id: 'task-2', key: 'ENG-2', title: 'Old', updatedAt: AT, project }],
    });

    const { items } = await service.list('org-1', {});

    expect(items[0]?.firstSeenAt).toBe(AT.toISOString());
  });

  it('yields two items for a task that is both human-review and awaiting approval', async () => {
    // Two distinct decisions on one task — not a duplicate, and not three items.
    const { service } = harness({
      approvals: [
        {
          id: 'approval-1',
          kind: 'PLAN',
          reason: null,
          taskId: 'task-1',
          createdAt: AT,
          project,
          task: { key: 'ENG-1' },
        },
      ],
      tasks: [{ id: 'task-1', key: 'ENG-1', title: 'Same task', updatedAt: AT, project }],
    });

    const { items } = await service.list('org-1', {});

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => `${item.type}:${item.sourceId}`)).size).toBe(2);
  });

  it('drops a finding whose review run has no task, since it has no project', async () => {
    const { service } = harness({
      findings: [
        {
          id: 'finding-orphan',
          severity: Severity.HIGH,
          problem: 'Orphan',
          requiredFix: 'n/a',
          createdAt: AT,
          reviewRun: { taskId: null, task: null },
        },
      ],
    });

    await expect(service.list('org-1', {})).resolves.toEqual({ items: [] });
  });

  it('filters by type and by severity', async () => {
    const sources = {
      tasks: [{ id: 'task-2', key: 'ENG-2', title: 'Review me', updatedAt: AT, project }],
      findings: [
        {
          id: 'finding-1',
          severity: Severity.CRITICAL,
          problem: 'Bad',
          requiredFix: 'Fix',
          createdAt: AT,
          reviewRun: { taskId: 'task-4', task: { key: 'ENG-4', projectId: 'project-1', project } },
        },
      ],
    };

    const byType = await harness(sources).service.list('org-1', {
      type: inboxItemType.BLOCKING_FINDING,
    });
    expect(byType.items).toHaveLength(1);
    expect(byType.items[0]?.type).toBe(inboxItemType.BLOCKING_FINDING);

    const bySeverity = await harness(sources).service.list('org-1', {
      severity: Severity.CRITICAL,
    });
    expect(bySeverity.items).toHaveLength(1);
    expect(bySeverity.items[0]?.sourceId).toBe('finding-1');
  });
});

describe('InboxService tenant isolation', () => {
  // One test per source. Four aggregated sources is four chances to leak, and a
  // single shared assertion would not catch a miss in one of them.

  it('scopes pending approvals to the organization', async () => {
    const { service, approvalFindMany } = harness({});
    await service.list('org-1', {});

    const where = approvalFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.status).toBe(ApprovalStatus.PENDING);
    expect(JSON.stringify(where)).toContain('org-1');
    expect(where.AND).toBeDefined();
  });

  it('scopes human-review tasks through the project organization', async () => {
    const { service, taskFindMany } = harness({});
    await service.list('org-1', {});

    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: TaskStatus.NEEDS_HUMAN_REVIEW,
          project: expect.objectContaining({ organizationId: 'org-1' }),
        }),
      }),
    );
  });

  it('scopes failed workflow runs to the organization', async () => {
    const { service, runFindMany } = harness({});
    await service.list('org-1', {});

    const where = runFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.status).toBe(RunStatus.FAILED);
    expect(JSON.stringify(where)).toContain('org-1');
  });

  it('scopes blocking findings to the organization and to open statuses', async () => {
    const { service, findingFindMany } = harness({});
    await service.list('org-1', {});

    const where = findingFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.severity).toEqual({ in: [Severity.CRITICAL, Severity.HIGH] });
    expect(where.status).toEqual({ in: [FindingStatus.OPEN, FindingStatus.FIXING] });
    expect(JSON.stringify(where)).toContain('org-1');
  });

  it('passes a project filter down to every source', async () => {
    const h = harness({});
    await h.service.list('org-1', { projectId: 'project-9' });

    for (const call of [h.approvalFindMany, h.taskFindMany, h.runFindMany, h.findingFindMany]) {
      expect(JSON.stringify(call.mock.calls[0]?.[0]?.where)).toContain('project-9');
    }
  });

  it('reads nothing outside the four source tables', async () => {
    // Guards the "computed, not materialised" property: if an inbox table were
    // ever introduced, this test is where it would surface.
    const h = harness({});
    await h.service.list('org-1', {});

    expect(h.approvalFindMany).toHaveBeenCalledTimes(1);
    expect(h.taskFindMany).toHaveBeenCalledTimes(1);
    expect(h.runFindMany).toHaveBeenCalledTimes(1);
    expect(h.findingFindMany).toHaveBeenCalledTimes(1);
  });
});
