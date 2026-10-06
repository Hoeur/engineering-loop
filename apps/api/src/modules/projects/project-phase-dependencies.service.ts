import { Injectable } from '@nestjs/common';
import type { Prisma } from '@engloop/db';
import { ApiErrorCode } from '@engloop/types';
import { validatePhaseDependencies } from '@engloop/workflow';
import { AppError } from '../../common/errors/app-error';

export const phaseSummaryInclude = {
  _count: { select: { tasks: true } },
  dependencies: { select: { dependsOnPhaseId: true }, orderBy: { dependsOnPhaseId: 'asc' } },
} as const;

export function phaseSummary(
  phase: Prisma.ProjectPhaseGetPayload<{ include: typeof phaseSummaryInclude }>,
) {
  const { dependencies, ...summary } = phase;
  return { ...summary, dependencyIds: dependencies.map((edge) => edge.dependsOnPhaseId) };
}

@Injectable()
export class ProjectPhaseDependenciesService {
  async replace(
    tx: Prisma.TransactionClient,
    projectId: string,
    phaseId: string,
    dependencyIds: string[],
  ): Promise<boolean> {
    const phases = await tx.projectPhase.findMany({ where: { projectId }, select: { id: true } });
    const edges = await tx.projectPhaseDependency.findMany({
      where: { projectId },
      select: { phaseId: true, dependsOnPhaseId: true },
    });
    const invalid = validatePhaseDependencies(
      phases.map((phase) => phase.id),
      edges,
      phaseId,
      dependencyIds,
    );
    if (invalid) {
      const code =
        invalid === 'CYCLE'
          ? ApiErrorCode.PHASE_DEPENDENCY_CYCLE
          : ApiErrorCode.INVALID_PHASE_DEPENDENCY;
      throw AppError.badRequest(
        code,
        'Phase dependencies must be unique, same-project references without self-dependencies or cycles',
      );
    }
    const previous = edges
      .filter((edge) => edge.phaseId === phaseId)
      .map((edge) => edge.dependsOnPhaseId)
      .sort();
    if (JSON.stringify(previous) === JSON.stringify([...dependencyIds].sort())) return false;
    await tx.projectPhaseDependency.deleteMany({ where: { projectId, phaseId } });
    if (dependencyIds.length > 0)
      await tx.projectPhaseDependency.createMany({
        data: dependencyIds.map((dependsOnPhaseId) => ({ projectId, phaseId, dependsOnPhaseId })),
      });
    return true;
  }

  async assertDeletable(tx: Prisma.TransactionClient, projectId: string, phaseId: string) {
    if (await tx.projectPhaseDependency.count({ where: { projectId, dependsOnPhaseId: phaseId } }))
      throw AppError.conflict(
        ApiErrorCode.PHASE_HAS_DEPENDENTS,
        'Remove dependencies on this phase explicitly before deleting it',
      );
  }
}
