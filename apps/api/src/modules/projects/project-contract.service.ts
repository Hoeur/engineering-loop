import { Injectable } from '@nestjs/common';
import { AuditAction, OrgRole } from '@engloop/types';
import type { ProjectContract } from '@engloop/types';
import type { ReplaceProjectContractDto } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const selectContract = {
  contractObjective: true,
  contractRequirements: true,
  contractNonGoals: true,
  contractAcceptanceCriteria: true,
} as const;
function contract(project: {
  contractObjective: string | null;
  contractRequirements: string[];
  contractNonGoals: string[];
  contractAcceptanceCriteria: string[];
}): ProjectContract {
  return {
    objective: project.contractObjective,
    requirements: project.contractRequirements,
    nonGoals: project.contractNonGoals,
    acceptanceCriteria: project.contractAcceptanceCriteria,
  };
}

@Injectable()
export class ProjectContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async read(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: selectContract,
    });
    if (!project) throw AppError.notFound('Project', projectId);
    return contract(project);
  }

  async replace(
    organizationId: string,
    role: string,
    projectId: string,
    dto: ReplaceProjectContractDto,
  ) {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN)
      throw AppError.forbidden(
        'Only organization owners and administrators can edit the project contract',
      );
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        if (rows.length === 0) throw AppError.notFound('Project', projectId);
        const existing = await tx.project.findFirst({
          where: { id: projectId, organizationId },
          select: selectContract,
        });
        if (!existing) throw AppError.notFound('Project', projectId);
        if (
          JSON.stringify(contract(existing)) ===
          JSON.stringify({
            objective: dto.objective,
            requirements: dto.requirements,
            nonGoals: dto.nonGoals,
            acceptanceCriteria: dto.acceptanceCriteria,
          })
        )
          return contract(existing);
        const updated = await tx.project.update({
          where: { id: projectId },
          data: {
            contractObjective: dto.objective,
            contractRequirements: dto.requirements,
            contractNonGoals: dto.nonGoals,
            contractAcceptanceCriteria: dto.acceptanceCriteria,
          },
          select: selectContract,
        });
        await this.audit.recordInTransaction(tx, {
          organizationId,
          projectId,
          action: AuditAction.CONFIGURATION_CHANGED,
          entityType: 'projectContract',
          entityId: projectId,
          summary: 'Replaced draft project contract',
          metadata: { changes: dto },
        });
        return contract(updated);
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }
}
