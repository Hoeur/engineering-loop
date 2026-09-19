import type { CheckType } from '@engloop/types';
import type { Prisma, PrismaClient } from '@engloop/db';
import type { PlannerOutput } from '@engloop/schemas';

/**
 * Converts a validated planner output into real child tasks (spec section 7,
 * "tasks/TODO generated").
 *
 * Runs in one transaction so a partially-materialised plan is impossible, and
 * resolves the planner's index-based `dependsOn` into real TaskDependency rows.
 */
export class PlanMaterializer {
  constructor(private readonly prisma: PrismaClient) {}

  async materialize(
    parentTaskId: string,
    plan: PlannerOutput,
  ): Promise<{ createdTaskIds: string[] }> {
    const parent = await this.prisma.task.findUniqueOrThrow({
      where: { id: parentTaskId },
      select: {
        id: true,
        projectId: true,
        repositoryId: true,
        epicId: true,
        featureId: true,
        createdById: true,
        maxAttempts: true,
      },
    });

    return this.prisma.$transaction(async (tx) => {
      // Persist the plan on the parent so the task detail page can show it.
      await tx.task.update({
        where: { id: parentTaskId },
        data: {
          planSummary: plan.summary,
          plan: plan as unknown as Prisma.InputJsonValue,
          acceptanceCriteria:
            plan.acceptanceCriteria.length > 0 ? plan.acceptanceCriteria : undefined,
          requiredChecks:
            plan.requiredChecks.length > 0 ? (plan.requiredChecks as CheckType[]) : undefined,
        },
      });

      const createdTaskIds: string[] = [];

      for (const planned of plan.tasks) {
        const project = await tx.project.update({
          where: { id: parent.projectId },
          data: { taskSequence: { increment: 1 } },
          select: { key: true, taskSequence: true },
        });

        const child = await tx.task.create({
          data: {
            projectId: parent.projectId,
            repositoryId: parent.repositoryId,
            epicId: parent.epicId,
            featureId: parent.featureId,
            parentTaskId: parent.id,
            key: `${project.key}-${String(project.taskSequence)}`,
            title: planned.title,
            description: planned.description,
            objective: planned.objective,
            type: planned.type,
            priority: planned.priority,
            riskLevel: planned.riskLevel,
            acceptanceCriteria: planned.acceptanceCriteria,
            implementationNotes: planned.implementationNotes,
            suggestedFiles: planned.suggestedFiles,
            requiredChecks: planned.requiredChecks as CheckType[],
            maxAttempts: parent.maxAttempts,
            createdById: parent.createdById,
          },
        });
        createdTaskIds.push(child.id);
      }

      // Index-based dependencies from the plan become real edges.
      const edges: { taskId: string; dependsOnTaskId: string }[] = [];
      plan.tasks.forEach((planned, index) => {
        const taskId = createdTaskIds[index];
        if (!taskId) return;
        for (const dependencyIndex of planned.dependsOn) {
          const dependsOnTaskId = createdTaskIds[dependencyIndex];
          if (dependsOnTaskId && dependsOnTaskId !== taskId) {
            edges.push({ taskId, dependsOnTaskId });
          }
        }
      });

      if (edges.length > 0) {
        await tx.taskDependency.createMany({ data: edges, skipDuplicates: true });
      }

      return { createdTaskIds };
    });
  }
}
