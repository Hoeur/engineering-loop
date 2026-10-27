import { Injectable } from '@nestjs/common';
import { Prisma, type Task } from '@engloop/db';
import type { UpdateTaskDto } from '@engloop/schemas';
import {
  AgentRole,
  AgentRunStatus,
  ApiErrorCode,
  AuditAction,
  ProjectPhaseStatus,
  RunStatus,
  TaskStatus,
} from '@engloop/types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const editableStatuses: readonly TaskStatus[] = [
  TaskStatus.BACKLOG,
  TaskStatus.PLAN_READY,
  TaskStatus.BLOCKED,
  TaskStatus.FAILED,
];

@Injectable()
export class TaskEditingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async update(organizationId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      // Phase and snapshot operations use project-before-task locking too.
      const owned = await tx.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM projects p JOIN tasks t ON t."projectId" = p.id
        WHERE t.id = ${id} AND p."organizationId" = ${organizationId} FOR NO KEY UPDATE OF p
      `;
      if (owned.length !== 1) throw AppError.notFound('Task', id);
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`;
      const task = await tx.task.findUniqueOrThrow({
        where: { id },
        include: {
          phase: { select: { status: true } },
          project: { select: { teamConfigured: true } },
        },
      });
      if (task.updatedAt.toISOString() !== dto.expectedUpdatedAt)
        throw AppError.conflict(ApiErrorCode.CONFLICT, 'Task changed; reload before saving', {
          currentUpdatedAt: task.updatedAt.toISOString(),
        });
      if (
        !editableStatuses.includes(task.status) ||
        task.phase?.status === ProjectPhaseStatus.ACCEPTED
      )
        throw AppError.conflict(
          ApiErrorCode.TASK_EDIT_LOCKED,
          'Only idle planning tasks outside accepted phases can be edited',
        );

      const [workflow, agentRun, tests, review, commit, pullRequest, children] = await Promise.all([
        tx.workflowRun.findFirst({
          where: {
            taskId: id,
            status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
          },
          select: { id: true },
        }),
        tx.agentRun.findFirst({
          where: {
            taskId: id,
            OR: [
              { status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] } },
              { role: { not: AgentRole.PLANNER } },
            ],
          },
          select: { id: true },
        }),
        tx.testRun.findFirst({ where: { taskId: id }, select: { id: true } }),
        tx.reviewRun.findFirst({ where: { taskId: id }, select: { id: true } }),
        tx.commit.findFirst({ where: { taskId: id }, select: { id: true } }),
        tx.pullRequest.findFirst({ where: { taskId: id }, select: { id: true } }),
        tx.task.findFirst({ where: { parentTaskId: id }, select: { id: true } }),
      ]);
      if (workflow || agentRun || tests || review || commit || pullRequest || children)
        throw AppError.conflict(
          ApiErrorCode.TASK_EDIT_LOCKED,
          'Finish or cancel active work first. Tasks with implementation evidence or planned children need a follow-up task.',
        );

      await this.validateReferences(
        tx,
        organizationId,
        task.projectId,
        task.project.teamConfigured,
        dto,
      );
      const { expectedUpdatedAt: _expected, ...changes } = dto;
      // Keep historical planner runs intact, but never show their old plan as current.
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...changes,
          plan: Prisma.DbNull,
          planSummary: null,
          updatedAt: new Date(Math.max(Date.now(), task.updatedAt.getTime() + 1)),
          lastActivityAt: new Date(),
        },
      });
      await this.audit.recordInTransaction(tx, {
        organizationId,
        projectId: task.projectId,
        taskId: id,
        action: AuditAction.CONFIGURATION_CHANGED,
        entityType: 'task',
        entityId: id,
        summary: `Edited planning inputs for ${task.key}`,
        actorType: 'USER',
        metadata: { fields: Object.keys(changes), previousUpdatedAt: dto.expectedUpdatedAt },
      });
      return updated;
    });
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    teamConfigured: boolean,
    dto: UpdateTaskDto,
  ): Promise<void> {
    const checks: Array<Promise<boolean>> = [];
    if (dto.repositoryId)
      checks.push(
        tx.repository
          .count({ where: { id: dto.repositoryId, projectId } })
          .then((count) => count === 1),
      );
    if (dto.epicId)
      checks.push(
        tx.epic.count({ where: { id: dto.epicId, projectId } }).then((count) => count === 1),
      );
    if (dto.featureId)
      checks.push(
        tx.feature.count({ where: { id: dto.featureId, projectId } }).then((count) => count === 1),
      );
    if (dto.assignedAgentId)
      checks.push(
        tx.agent
          .count({
            where: {
              id: dto.assignedAgentId,
              organizationId,
              enabled: true,
              OR: [{ projectId }, { projectId: null }],
              provider: { organizationId, enabled: true },
              ...(teamConfigured ? { teamMemberships: { some: { projectId } } } : {}),
            },
          })
          .then((count) => count === 1),
      );
    if ((await Promise.all(checks)).some((valid) => !valid))
      throw AppError.validation(
        'Task references must belong to the project and assigned agents must be eligible',
      );
  }
}
