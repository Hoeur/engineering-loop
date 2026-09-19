import { Injectable } from '@nestjs/common';
import {
  AgentRunStatus,
  AuditAction,
  DomainEventName,
  RunStatus,
  TaskStatus,
} from '@engloop/types';
import { ACTIVE_TASK_STATUSES, taskStateMachine } from '@engloop/workflow';
import type { Prisma, Task } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventBus } from '../../infrastructure/events/event-bus';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { ownedAgentRunWhere } from '../../common/tenant-ownership';

export interface TransitionOptions {
  reason?: string;
  /** Extra columns to write in the same transaction as the status change. */
  data?: Prisma.TaskUpdateManyMutationInput;
  actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'SCHEDULE';
}

/**
 * The ONLY writer of `task.status`.
 *
 * Every caller — controllers, workflow steps, queue processors — goes through
 * here, so an illegal transition is impossible rather than merely discouraged
 * (spec section 6).
 */
@Injectable()
export class TaskTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return taskStateMachine.can(from, to);
  }

  allowedNext(from: TaskStatus): readonly TaskStatus[] {
    return taskStateMachine.nextStates(from);
  }

  async cancelWithWorkflows(
    organizationId: string,
    taskId: string,
    reason: string,
    workflowRunId?: string,
  ): Promise<{ task: Task; workflowRunIds: string[]; agentRunIds: string[] }> {
    const committed = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT t.id FROM tasks t
        JOIN projects p ON p.id = t."projectId"
        WHERE t.id = ${taskId} AND p."organizationId" = ${organizationId}
        FOR UPDATE OF t
      `;
      if (owned.length !== 1) throw AppError.notFound('Task', taskId);

      const task = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { id: true, key: true, status: true, projectId: true },
      });
      if (task.status !== TaskStatus.CANCELLED) {
        taskStateMachine.assert(task.status, TaskStatus.CANCELLED);
      }

      const activeStatuses = [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN];
      const runs = await tx.workflowRun.findMany({
        where: {
          taskId,
          projectId: task.projectId,
          project: { organizationId },
          status: { in: activeStatuses },
        },
        select: { id: true },
      });
      if (workflowRunId && !runs.some((run) => run.id === workflowRunId)) {
        throw AppError.conflict('CONFLICT', 'Workflow run finished before cancellation was claimed');
      }
      const workflowRunIds = runs.map((run) => run.id);
      if (runs.length > 0) {
        const claimed = await tx.workflowRun.updateMany({
          where: { id: { in: workflowRunIds }, status: { in: activeStatuses } },
          data: {
            status: RunStatus.CANCELLED,
            error: reason,
            completedAt: new Date(),
            currentStepKey: null,
          },
        });
        if (claimed.count !== runs.length) {
          throw AppError.conflict('CONFLICT', 'Workflow run changed during cancellation');
        }
        await tx.workflowStep.updateMany({
          where: {
            workflowRunId: { in: workflowRunIds },
            status: RunStatus.RUNNING,
          },
          data: { status: RunStatus.CANCELLED, error: reason, finishedAt: new Date() },
        });
      }

      // Claim child executions before committing the parent cancellation. The
      // worker completes a provider result only while its AgentRun is RUNNING,
      // so this closes the window where a late result could persist success,
      // output, usage, or cost under a cancelled task.
      const agentRunWhere: Prisma.AgentRunWhereInput = {
        ...ownedAgentRunWhere(organizationId, task.projectId),
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
        OR: [
          { taskId },
          ...(workflowRunIds.length > 0
            ? [
                { workflowRunId: { in: workflowRunIds } },
                { workflowStep: { workflowRunId: { in: workflowRunIds } } },
              ]
            : []),
        ],
      };
      const agentRuns = await tx.agentRun.updateManyAndReturn({
        where: agentRunWhere,
        data: {
          status: AgentRunStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: reason,
        },
        select: { id: true, role: true, providerKey: true, taskId: true },
      });
      if (agentRuns.length > 0) {
        await tx.auditLog.createMany({
          data: agentRuns.map((run) => ({
            organizationId,
            projectId: task.projectId,
            taskId: run.taskId,
            action: AuditAction.AGENT_STOPPED,
            entityType: 'agent_run',
            entityId: run.id,
            summary: `Cancelled ${run.role} run on ${run.providerKey}`,
            metadata: { reason } as Prisma.InputJsonValue,
            actorType: 'USER',
          })),
        });
      }

      if (task.status !== TaskStatus.CANCELLED) {
        const claimed = await tx.task.updateMany({
          where: { id: taskId, status: task.status },
          data: {
            status: TaskStatus.CANCELLED,
            lastActivityAt: new Date(),
            completedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict('CONFLICT', 'Task changed during cancellation');
        }
      }

      return {
        task: await tx.task.findUniqueOrThrow({ where: { id: taskId } }),
        workflowRunIds,
        agentRunIds: agentRuns.map((run) => run.id),
        from: task.status,
        key: task.key,
        projectId: task.projectId,
      };
    });

    if (committed.from !== TaskStatus.CANCELLED) {
      this.events.publish(DomainEventName.TASK_STATUS_CHANGED, {
        taskId, taskKey: committed.key, from: committed.from,
        to: TaskStatus.CANCELLED, reason,
      });
      await this.audit.recordSafe({
        organizationId, projectId: committed.projectId, taskId,
        action: AuditAction.TASK_TRANSITIONED,
        entityType: 'task', entityId: taskId,
        summary: `${committed.key}: ${committed.from} → ${TaskStatus.CANCELLED}`,
        metadata: { from: committed.from, to: TaskStatus.CANCELLED, reason },
        actorType: 'USER',
      });
    }
    return {
      task: committed.task,
      workflowRunIds: committed.workflowRunIds,
      agentRunIds: committed.agentRunIds,
    };
  }

  async transition(taskId: string, to: TaskStatus, options: TransitionOptions = {}): Promise<Task> {
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

    const from = task.status;
    if (from === to) {
      const claimed = await this.prisma.task.updateMany({
        where: { id: taskId, status: from },
        data: { ...options.data, lastActivityAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw AppError.conflict('CONFLICT', 'Task status changed before the update completed');
      }
      return this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    }

    // Throws InvalidTransitionError, mapped to 409 TASK_INVALID_TRANSITION.
    taskStateMachine.assert(from, to);

    const now = new Date();
    const timestamps: Prisma.TaskUpdateInput = {};
    if (ACTIVE_TASK_STATUSES.includes(to) && !ACTIVE_TASK_STATUSES.includes(from)) {
      timestamps.startedAt = { set: now };
    }
    if (to === TaskStatus.COMPLETED || to === TaskStatus.CANCELLED) {
      timestamps.completedAt = { set: now };
    }

    const claimed = await this.prisma.task.updateMany({
      where: { id: taskId, status: from },
      data: {
        status: to,
        lastActivityAt: now,
        ...(options.reason && to === TaskStatus.BLOCKED ? { blockedReason: options.reason } : {}),
        ...timestamps,
        ...options.data,
      },
    });
    if (claimed.count !== 1) {
      throw AppError.conflict('CONFLICT', 'Task status changed before the transition completed');
    }
    const updated = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    this.events.publish(DomainEventName.TASK_STATUS_CHANGED, {
      taskId,
      taskKey: task.key,
      from,
      to,
      reason: options.reason,
    });

    await this.audit.recordSafe({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId,
      action: AuditAction.TASK_TRANSITIONED,
      entityType: 'task',
      entityId: taskId,
      summary: `${task.key}: ${from} → ${to}`,
      metadata: { from, to, reason: options.reason ?? null },
      actorType: options.actorType,
    });

    return updated;
  }

  /** Moves a task toward a target even when several hops are required. */
  async transitionThrough(
    taskId: string,
    target: TaskStatus,
    options: TransitionOptions = {},
  ): Promise<Task | null> {
    const current = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { status: true },
    });
    const path = taskStateMachine.path(current.status, target);
    if (!path) return null;

    let last: Task | null = null;
    for (const state of path.slice(1)) {
      last = await this.transition(
        taskId,
        state,
        state === target ? options : { reason: options.reason },
      );
    }
    return last;
  }
}
