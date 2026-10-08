import { Injectable } from '@nestjs/common';
import { ApiErrorCode, AuditAction, OrgRole, ProjectPhaseStatus } from '@engloop/types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { phaseSummary, phaseSummaryInclude } from './project-phase-dependencies.service';
import { assertEditablePhaseTask } from './project-phase-policy';

@Injectable()
export class ProjectPhaseLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async transition(
    organizationId: string,
    role: string,
    projectId: string,
    phaseId: string,
    reopen: boolean,
  ) {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN)
      throw AppError.forbidden('Only organization owners and administrators can manage phases');
    return this.prisma.$transaction(
      async (tx) => {
        const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${organizationId} FOR NO KEY UPDATE
      `;
        if (!projects.length) throw AppError.notFound('Project', projectId);
        const phase = await tx.projectPhase.findFirst({
          where: { id: phaseId, projectId },
          include: phaseSummaryInclude,
        });
        if (!phase) throw AppError.notFound('Project phase', phaseId);
        const status = reopen ? ProjectPhaseStatus.DRAFT : ProjectPhaseStatus.ACTIVE;
        if (phase.status === status) return phaseSummary(phase);
        if (phase.status === ProjectPhaseStatus.ACCEPTED)
          throw AppError.conflict(
            ApiErrorCode.PHASE_LOCKED,
            'Accepted phases require a future evidence-gated revision',
          );
        if (reopen) {
          const tasks = await tx.task.findMany({
            where: { projectId, phaseId },
            select: { id: true },
            orderBy: { id: 'asc' },
          });
          for (const task of tasks) {
            try {
              await assertEditablePhaseTask(tx, projectId, task.id);
            } catch (error) {
              if (error instanceof AppError && error.code === 'TASK_PHASE_LOCKED')
                throw AppError.conflict(
                  ApiErrorCode.PHASE_REOPEN_BLOCKED,
                  'Linked tasks must have no active execution before reopening',
                );
              throw error;
            }
          }
        } else {
          const prerequisites = await tx.projectPhaseDependency.findMany({
            where: { projectId, phaseId },
            select: { dependsOn: { select: { status: true } } },
          });
          if (prerequisites.some((edge) => edge.dependsOn.status !== ProjectPhaseStatus.ACCEPTED))
            throw AppError.conflict(
              ApiErrorCode.PHASE_PREREQUISITES_NOT_ACCEPTED,
              'Every prerequisite phase must be accepted before activation',
            );
        }
        const updated = await tx.projectPhase.update({
          where: { id: phaseId },
          data: { status },
          include: phaseSummaryInclude,
        });
        await this.audit.recordInTransaction(tx, {
          organizationId,
          projectId,
          entityId: phaseId,
          entityType: 'projectPhase',
          action: AuditAction.CONFIGURATION_CHANGED,
          summary: reopen
            ? 'Reopened project phase for planning'
            : 'Activated project phase planning contract',
          metadata: { previousStatus: phase.status, status },
        });
        return phaseSummary(updated);
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }
}
