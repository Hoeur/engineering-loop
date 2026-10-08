import type { Prisma, PrismaClient } from '@engloop/db';
import { ProjectPhaseStatus } from '@engloop/types';
import { plannerPhaseContextSchema, type PlannerOutput } from '@engloop/schemas';

export async function loadPlannerPhaseContext(
  prisma: PrismaClient | Prisma.TransactionClient,
  parent: { phaseId: string | null; projectId: string },
) {
  if (!parent.phaseId) return undefined;
  const phase = await prisma.projectPhase.findUnique({ where: { id: parent.phaseId } });
  if (!phase || phase.projectId !== parent.projectId || phase.status !== ProjectPhaseStatus.ACTIVE)
    throw new Error(
      'Planning requires the parent task to belong to an ACTIVE phase in its project',
    );
  const project = await prisma.project.findUniqueOrThrow({ where: { id: parent.projectId } });
  return plannerPhaseContextSchema.parse({
    phaseId: phase.id,
    phaseUpdatedAt: phase.updatedAt.toISOString(),
    projectRequirements: project.contractRequirements,
    projectObjective: project.contractObjective,
    projectNonGoals: project.contractNonGoals,
    projectAcceptanceCriteria: project.contractAcceptanceCriteria,
    name: phase.name,
    objective: phase.objective,
    deliverables: phase.deliverables,
    acceptanceCriteria: phase.acceptanceCriteria,
    requiredRoles: phase.requiredRoles,
  });
}

export function assertPlannerPhaseScope(
  plan: PlannerOutput,
  expected: { phaseId: string; phaseUpdatedAt: string } | undefined,
) {
  if (!expected) {
    if (plan.phaseScope) throw new Error('An unphased task cannot materialize a phase-scoped plan');
    return;
  }
  if (
    plan.phaseScope?.phaseId !== expected.phaseId ||
    plan.phaseScope.phaseUpdatedAt !== expected.phaseUpdatedAt
  )
    throw new Error('Planner phase scope does not match the current ACTIVE phase contract');
}
