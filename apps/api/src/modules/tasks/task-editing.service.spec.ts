import { describe, expect, it, vi } from 'vitest';
import {
  AgentRole,
  AgentRunStatus,
  ProjectPhaseStatus,
  RunStatus,
  TaskStatus,
} from '@engloop/types';
import { updateAgentSchema, updateTaskSchema } from '@engloop/schemas';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TaskEditingService } from './task-editing.service';

const time = '2026-10-27T00:00:00.000Z';
function setup() {
  const task = {
    id: 'task',
    projectId: 'project',
    key: 'ED-1',
    status: TaskStatus.BACKLOG as TaskStatus,
    updatedAt: new Date(time),
    phase: null as null | { status: ProjectPhaseStatus },
    project: { teamConfigured: false },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'project' }]),
    task: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(task),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ...task, title: 'Edited task' }),
    },
    workflowRun: { findFirst: vi.fn().mockResolvedValue(null) },
    agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
    testRun: { findFirst: vi.fn().mockResolvedValue(null) },
    reviewRun: { findFirst: vi.fn().mockResolvedValue(null) },
    commit: { findFirst: vi.fn().mockResolvedValue(null) },
    pullRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    repository: { count: vi.fn().mockResolvedValue(1) },
    epic: { count: vi.fn().mockResolvedValue(1) },
    feature: { count: vi.fn().mockResolvedValue(1) },
    agent: { count: vi.fn().mockResolvedValue(1) },
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const service = new TaskEditingService(prisma as unknown as PrismaService, audit as never);
  return { task, tx, audit, service };
}
const edit = { expectedUpdatedAt: time, title: 'Edited task' };

describe('Task planning edits', () => {
  it('requires versions for general agent edits while retaining limit and revocation compatibility', () => {
    expect(updateAgentSchema.safeParse({ name: 'Changed agent' }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ maxCostUsd: 0 }).success).toBe(true);
    expect(updateAgentSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(
      updateAgentSchema.safeParse({ name: 'Changed agent', expectedUpdatedAt: time }).success,
    ).toBe(true);
    expect(updateAgentSchema.safeParse({ expectedUpdatedAt: time }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ configuration: { token: 'ignored' } }).success).toBe(
      false,
    );
  });
  it('requires a version and actual changes, and rejects status/membership writes', () => {
    for (const value of [
      { title: 'New title' },
      { expectedUpdatedAt: time },
      { ...edit, status: 'COMPLETED' },
      { ...edit, parentTaskId: 'parent' },
      { ...edit, phaseId: 'phase' },
    ])
      expect(updateTaskSchema.safeParse(value).success).toBe(false);
    expect(updateTaskSchema.parse(edit)).toEqual(edit);
  });
  it('locks project before task, clears only current plan and audits field names atomically', async () => {
    const { tx, audit, service } = setup();
    await service.update('org', 'task', edit);
    expect(tx.$queryRaw.mock.calls[0]?.[0].join('')).toContain('FOR NO KEY UPDATE OF p');
    expect(tx.$queryRaw.mock.calls[1]?.[0].join('')).toContain('FOR UPDATE');
    expect(tx.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: edit.title, planSummary: null }),
      }),
    );
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ metadata: { fields: ['title'], previousUpdatedAt: time } }),
    );
    expect(JSON.stringify(audit.recordInTransaction.mock.calls)).not.toContain(edit.title);
  });
  it('returns not found for foreign ownership before reading or mutating inputs', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.update('foreign', 'task', edit)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tx.task.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('rejects a stale baseline without saving or auditing', async () => {
    const { service, tx, audit } = setup();
    await expect(
      service.update('org', 'task', { ...edit, expectedUpdatedAt: '2026-10-26T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });
  it.each([
    TaskStatus.QUEUED,
    TaskStatus.PLANNING,
    TaskStatus.IMPLEMENTING,
    TaskStatus.APPROVED,
    TaskStatus.NEEDS_HUMAN_REVIEW,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ])('locks %s tasks', async (status) => {
    const { task, service, tx } = setup();
    task.status = status;
    await expect(service.update('org', 'task', edit)).rejects.toMatchObject({
      code: 'TASK_EDIT_LOCKED',
    });
    expect(tx.task.update).not.toHaveBeenCalled();
  });
  it('locks tasks belonging to accepted phases', async () => {
    const { task, service } = setup();
    task.phase = { status: ProjectPhaseStatus.ACCEPTED };
    await expect(service.update('org', 'task', edit)).rejects.toMatchObject({
      code: 'TASK_EDIT_LOCKED',
    });
  });
  it.each([
    'workflowRun',
    'agentRun',
    'testRun',
    'reviewRun',
    'commit',
    'pullRequest',
    'task',
  ] as const)('locks existing work recorded in %s', async (source) => {
    const { tx, service } = setup();
    tx[source].findFirst.mockResolvedValue({ id: 'existing' } as never);
    await expect(service.update('org', 'task', edit)).rejects.toMatchObject({
      code: 'TASK_EDIT_LOCKED',
    });
    expect(tx.task.update).not.toHaveBeenCalled();
  });
  it('checks live runs including human waits and historical non-planner work', async () => {
    const { service, tx } = setup();
    await service.update('org', 'task', edit);
    expect(tx.workflowRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task',
          status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
        },
      }),
    );
    expect(tx.agentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task',
          OR: [
            { status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] } },
            { role: { not: AgentRole.PLANNER } },
          ],
        },
      }),
    );
  });
  it('rejects cross-project references and unavailable agents', async () => {
    const { service, tx } = setup();
    tx.repository.count.mockResolvedValue(0);
    await expect(
      service.update('org', 'task', { ...edit, repositoryId: 'foreign' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(tx.task.update).not.toHaveBeenCalled();
  });
  it('requires an eligible configured team member', async () => {
    const { task, service, tx } = setup();
    task.project.teamConfigured = true;
    await service.update('org', 'task', { ...edit, assignedAgentId: 'agent' });
    expect(tx.agent.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        enabled: true,
        provider: { organizationId: 'org', enabled: true },
        teamMemberships: { some: { projectId: 'project' } },
      }),
    });
  });
});
