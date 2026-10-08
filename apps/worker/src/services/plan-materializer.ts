import { AuditAction, type CheckType } from '@engloop/types';
import { retryOnUniqueViolation, type Prisma, type PrismaClient } from '@engloop/db';
import { plannerOutputSchema, type PlannerOutput } from '@engloop/schemas';
import { assertPlannerPhaseScope, loadPlannerPhaseContext } from './planner-phase-scope';

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
    // Other callers can pass typed values without the agent-output parsing boundary.
    plan = plannerOutputSchema.parse(plan);
    const parent = await this.prisma.task.findUniqueOrThrow({
      where: { id: parentTaskId },
      select: { projectId: true },
    });

    // Retried as a whole: each child task mints a project-scoped key, so a
    // concurrent create can collide and the retry re-reads the sequence.
    return retryOnUniqueViolation(() =>
      this.prisma.$transaction(async (tx) => {
        // Match graph writers' project-first lock order before updating the parent task.
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${parent.projectId} FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${parentTaskId} FOR UPDATE`;
        const currentParent = await tx.task.findUniqueOrThrow({ where: { id: parentTaskId } });
        if (currentParent.projectId !== parent.projectId)
          throw new Error('Parent project changed during plan materialization');
        const phaseContext = await loadPlannerPhaseContext(tx, currentParent);
        assertPlannerPhaseScope(plan, phaseContext);
        const projectContext = await tx.project.findUniqueOrThrow({
          where: { id: parent.projectId },
          select: { organizationId: true },
        });
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
              phaseId: currentParent.phaseId,
              ownerRole: planned.ownerRole ?? null,
              repositoryId: currentParent.repositoryId,
              epicId: currentParent.epicId,
              featureId: currentParent.featureId,
              parentTaskId: currentParent.id,
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
              maxAttempts: currentParent.maxAttempts,
              createdById: currentParent.createdById,
            },
          });
          createdTaskIds.push(child.id);
        }

        // Index-based dependencies from the plan become real edges.
        const edges: { taskId: string; dependsOnTaskId: string }[] = [];
        plan.tasks.forEach((planned, index) => {
          const taskId = createdTaskIds[index];
          if (!taskId) throw new Error('A planned task was not materialized');
          for (const dependencyIndex of planned.dependsOn) {
            const dependsOnTaskId = createdTaskIds[dependencyIndex];
            if (!dependsOnTaskId) throw new Error('A planned dependency was not materialized');
            edges.push({ taskId, dependsOnTaskId });
          }
        });

        if (edges.length > 0) {
          await tx.taskDependency.createMany({ data: edges });
        }

        await tx.auditLog.createMany({
          data: [
            {
              organizationId: projectContext.organizationId,
              projectId: parent.projectId,
              taskId: parentTaskId,
              action: AuditAction.CONFIGURATION_CHANGED,
              entityType: 'task',
              entityId: parentTaskId,
              summary: 'Materialized planner output',
              metadata: { createdTaskIds, phaseScope: plan.phaseScope ?? null },
            },
            ...createdTaskIds.map((id) => ({
              organizationId: projectContext.organizationId,
              projectId: parent.projectId,
              taskId: id,
              action: AuditAction.CONFIGURATION_CHANGED,
              entityType: 'task',
              entityId: id,
              summary: 'Created task from planner output',
              metadata: { parentTaskId },
            })),
          ],
        });

        return { createdTaskIds };
      }),
    );
  }
}
