import { Injectable } from '@nestjs/common';
import { ApiErrorCode, AuditAction, type TaskDependencyType } from '@engloop/types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TaskDependenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async add(
    organizationId: string,
    taskId: string,
    dependsOnTaskId: string,
    type: TaskDependencyType,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const source = await tx.task.findFirst({
          where: { id: taskId, project: { organizationId } },
          select: { projectId: true },
        });
        if (!source) throw AppError.notFound('Task', taskId);

        // All project graph writers share this lock so validation sees the preceding commit.
        const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${source.projectId}
        AND "organizationId" = ${organizationId} FOR NO KEY UPDATE`;
        if (rows.length === 0) throw AppError.notFound('Project', source.projectId);
        const task = await tx.task.findFirst({
          where: { id: taskId, projectId: source.projectId, project: { organizationId } },
          select: { projectId: true },
        });
        if (!task) throw AppError.notFound('Task', taskId);
        const dependency = await tx.task.findFirst({
          where: { id: dependsOnTaskId, project: { organizationId } },
          select: { projectId: true },
        });
        if (!dependency) throw AppError.notFound('Task', dependsOnTaskId);
        if (task.projectId !== dependency.projectId)
          throw AppError.badRequest(
            'TASK_REFERENCE_PROJECT_MISMATCH',
            'Task dependencies must belong to the same project',
          );
        if (taskId === dependsOnTaskId)
          throw AppError.badRequest(
            ApiErrorCode.TASK_DEPENDENCY_CYCLE,
            'A task cannot depend on itself',
          );

        const existing = await tx.taskDependency.findUnique({
          where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
        });
        if (existing) {
          if (existing.type === type) return existing;
          throw AppError.conflict(
            ApiErrorCode.TASK_DEPENDENCY_EXISTS,
            'The task dependency already exists with a different type',
            { taskId, dependsOnTaskId, type: existing.type },
          );
        }
        const edges = await tx.taskDependency.findMany({
          where: { task: { projectId: task.projectId } },
          select: { taskId: true, dependsOnTaskId: true },
        });
        const adjacency = new Map<string, string[]>();
        for (const edge of edges) {
          const targets = adjacency.get(edge.taskId) ?? [];
          targets.push(edge.dependsOnTaskId);
          adjacency.set(edge.taskId, targets);
        }
        const visited = new Set<string>();
        const pending = [dependsOnTaskId];
        while (pending.length > 0) {
          const current = pending.pop()!;
          if (current === taskId)
            throw AppError.conflict(
              ApiErrorCode.TASK_DEPENDENCY_CYCLE,
              'That dependency would create a cycle',
              {
                taskId,
                dependsOnTaskId,
              },
            );
          if (visited.has(current)) continue;
          visited.add(current);
          for (const target of adjacency.get(current) ?? []) pending.push(target);
        }
        const edge = await tx.taskDependency.create({ data: { taskId, dependsOnTaskId, type } });
        await this.audit.recordInTransaction(tx, {
          organizationId,
          projectId: task.projectId,
          taskId,
          action: AuditAction.CONFIGURATION_CHANGED,
          entityType: 'taskDependency',
          entityId: edge.id,
          summary: 'Added task dependency',
          metadata: { taskId, dependsOnTaskId, type },
        });
        return edge;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }
}
