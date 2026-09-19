import {
  AgentRunStatus,
  AuditAction,
  DomainEventName,
  RunStatus,
  TaskStatus,
} from '@engloop/types';
import { ACTIVE_TASK_STATUSES, taskStateMachine } from '@engloop/workflow';
import type { EngLoopLogger } from '@engloop/logger';
import type { Prisma, PrismaClient } from '@engloop/db';
import type { AuditWriter } from './audit-writer';

/**
 * Worker-side task transitions.
 *
 * Shares the state machine definition with the API through @engloop/workflow, so
 * the rules cannot diverge between the two processes.
 */
export class TaskTransitions {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditWriter,
    private readonly logger: EngLoopLogger,
  ) {}

  async finishWorkflow(
    workflowRunId: string,
    taskId: string,
    runStatus: RunStatus,
    target: TaskStatus,
    reason: string,
    traceId: string,
  ): Promise<boolean> {
    const committed = await this.prisma.$transaction(async (tx) => {
      // API starts/cancels and worker terminal decisions serialize on the same row.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE
      `;
      const task = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: {
          id: true, key: true, status: true, projectId: true,
          project: { select: { organizationId: true } },
        },
      });
      const claimed = await tx.workflowRun.updateMany({
        where: {
          id: workflowRunId,
          taskId,
          projectId: task.projectId,
          status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
        },
        data: {
          status: runStatus,
          error: runStatus === RunStatus.SUCCEEDED ? null : reason,
          completedAt: new Date(),
          currentStepKey: null,
        },
      });
      if (claimed.count !== 1) return null;

      const activeRunStatuses = [
        RunStatus.PENDING,
        RunStatus.RUNNING,
        RunStatus.WAITING_FOR_HUMAN,
      ];
      const siblings = await tx.workflowRun.findMany({
        where: {
          taskId,
          projectId: task.projectId,
          id: { not: workflowRunId },
          status: { in: activeRunStatuses },
        },
        select: { id: true },
      });
      const siblingIds = siblings.map((sibling) => sibling.id);
      if (siblingIds.length > 0) {
        await tx.workflowRun.updateMany({
          where: { id: { in: siblingIds }, status: { in: activeRunStatuses } },
          data: {
            status: RunStatus.CANCELLED,
            error: `Superseded by workflow ${workflowRunId}: ${reason}`,
            completedAt: new Date(),
            currentStepKey: null,
          },
        });
        await tx.workflowStep.updateMany({
          where: { workflowRunId: { in: siblingIds }, status: RunStatus.RUNNING },
          data: {
            status: RunStatus.CANCELLED,
            error: `Superseded by workflow ${workflowRunId}`,
            finishedAt: new Date(),
          },
        });
      }

      const activeAgents = await tx.agentRun.updateManyAndReturn({
        where: {
          status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
          OR: [
            { taskId },
            ...(siblingIds.length > 0
              ? [
                  { workflowRunId: { in: siblingIds } },
                  { workflowStep: { workflowRunId: { in: siblingIds } } },
                ]
              : []),
          ],
        },
        data: {
          status: AgentRunStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: `Superseded by workflow ${workflowRunId}`,
        },
        select: { id: true, role: true, providerKey: true },
      });
      if (activeAgents.length > 0) {
        await tx.auditLog.createMany({
          data: activeAgents.map((agent) => ({
            organizationId: task.project.organizationId,
            projectId: task.projectId,
            taskId,
            action: AuditAction.AGENT_STOPPED,
            entityType: 'agent_run',
            entityId: agent.id,
            summary: `Cancelled ${agent.role} run on ${agent.providerKey}`,
            metadata: { reason: `Superseded by workflow ${workflowRunId}` } as Prisma.InputJsonValue,
            actorType: 'SYSTEM',
            traceId,
          })),
        });
      }

      const path = taskStateMachine.path(task.status, target);
      if (!path) {
        throw new Error(`Task ${task.key} cannot transition from ${task.status} to ${target}`);
      }

      let current = task.status;
      for (const next of path.slice(1)) {
        const now = new Date();
        const extra: Prisma.TaskUpdateManyMutationInput = {};
        if (ACTIVE_TASK_STATUSES.includes(next) && !ACTIVE_TASK_STATUSES.includes(current)) {
          extra.startedAt = now;
        }
        if (next === TaskStatus.COMPLETED || next === TaskStatus.CANCELLED) {
          extra.completedAt = now;
        }
        const updated = await tx.task.updateMany({
          where: { id: taskId, status: current },
          data: { status: next, lastActivityAt: now, ...extra },
        });
        if (updated.count !== 1) {
          throw new Error(`Task ${task.key} changed concurrently from ${current}`);
        }
        current = next;
      }
      return { task, path };
    });
    if (!committed) return false;

    for (let index = 1; index < committed.path.length; index += 1) {
      const from = committed.path[index - 1];
      const to = committed.path[index];
      await this.audit.record({
        organizationId: committed.task.project.organizationId,
        projectId: committed.task.projectId,
        taskId,
        action: AuditAction.TASK_TRANSITIONED,
        entityType: 'task', entityId: taskId,
        summary: `${committed.task.key}: ${from} → ${to}`,
        metadata: { reason, event: DomainEventName.TASK_STATUS_CHANGED },
        traceId,
      });
    }
    return true;
  }

  async to(
    taskId: string,
    target: TaskStatus,
    options: { reason?: string; traceId?: string; data?: Prisma.TaskUpdateManyMutationInput } = {},
  ): Promise<TaskStatus> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        key: true,
        status: true,
        projectId: true,
        project: { select: { organizationId: true } },
      },
    });

    if (task.status === target) {
      if (options.data) {
        const claimed = await this.prisma.task.updateMany({
          where: { id: taskId, status: task.status },
          data: options.data,
        });
        if (claimed.count !== 1) {
          throw new Error(`Task ${task.key} changed concurrently`);
        }
      }
      return target;
    }

    // Walk the shortest legal path so the worker never needs to know the
    // intermediate states for a given jump.
    const path = taskStateMachine.path(task.status, target);
    if (!path) {
      this.logger.warn(
        { taskKey: task.key, from: task.status, to: target },
        'task.transition.unreachable',
      );
      throw new Error(`Task ${task.key} cannot transition from ${task.status} to ${target}`);
    }

    let current = task.status;
    for (const next of path.slice(1)) {
      const now = new Date();
      const extra: Prisma.TaskUpdateManyMutationInput = {};
      if (ACTIVE_TASK_STATUSES.includes(next) && !ACTIVE_TASK_STATUSES.includes(current)) {
        extra.startedAt = { set: now };
      }
      if (next === TaskStatus.COMPLETED || next === TaskStatus.CANCELLED) {
        extra.completedAt = { set: now };
      }

      const claimed = await this.prisma.task.updateMany({
        where: { id: taskId, status: current },
        data: {
          status: next,
          lastActivityAt: now,
          ...(next === TaskStatus.BLOCKED && options.reason
            ? { blockedReason: options.reason }
            : {}),
          ...extra,
          ...(next === target ? (options.data ?? {}) : {}),
        },
      });
      if (claimed.count !== 1) {
        throw new Error(`Task ${task.key} changed concurrently from ${current}`);
      }

      await this.audit.record({
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId,
        action: AuditAction.TASK_TRANSITIONED,
        entityType: 'task',
        entityId: taskId,
        summary: `${task.key}: ${current} → ${next}`,
        metadata: { reason: options.reason ?? null, event: DomainEventName.TASK_STATUS_CHANGED },
        traceId: options.traceId ?? null,
      });

      current = next;
    }

    return current;
  }
}
