import { Injectable } from '@nestjs/common';
import type { Prisma } from '@engloop/db';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { AgentRole, ApiErrorCode, AuditAction, OrgRole } from '@engloop/types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const memberSelect = {
  id: true,
  name: true,
  role: true,
  projectId: true,
  organizationId: true,
  enabled: true,
  model: true,
  provider: {
    select: { id: true, key: true, displayName: true, enabled: true, organizationId: true },
  },
} as const satisfies Prisma.AgentSelect;
const projectSelect = {
  teamConfigured: true,
  teamVersion: true,
  teamMembers: { orderBy: { agentId: 'asc' }, select: { agent: { select: memberSelect } } },
} as const satisfies Prisma.ProjectSelect;

function team(
  project: Prisma.ProjectGetPayload<{ select: typeof projectSelect }>,
  organizationId: string,
  projectId: string,
) {
  const members = project.teamMembers
    .filter(
      ({ agent }) =>
        agent.organizationId === organizationId &&
        agent.provider.organizationId === organizationId &&
        (agent.projectId === null || agent.projectId === projectId),
    )
    .map(({ agent }) => ({
      ...agent,
      eligible:
        agent.organizationId === organizationId &&
        agent.enabled &&
        (agent.projectId === null || agent.projectId === projectId) &&
        agent.provider.organizationId === organizationId &&
        agent.provider.enabled,
    }));
  const coverage = Object.values(AgentRole).map((role) => {
    const agentIds = members
      .filter((agent) => agent.role === role && agent.eligible)
      .map((agent) => agent.id);
    return { role, covered: agentIds.length > 0, agentIds };
  });
  return { configured: project.teamConfigured, version: project.teamVersion, members, coverage };
}

@Injectable()
export class ProjectTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async read(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: projectSelect,
    });
    if (!project) throw AppError.notFound('Project', projectId);
    return team(project, organizationId, projectId);
  }

  async roleCoverage(organizationId: string, projectId: string, phaseId: string) {
    const phase = await this.prisma.projectPhase.findFirst({
      where: { id: phaseId, projectId, project: { organizationId } },
      select: { requiredRoles: true },
    });
    if (!phase) throw AppError.notFound('ProjectPhase', phaseId);
    const roster = await this.read(organizationId, projectId);
    const coverage = roster.coverage.filter(({ role }) => phase.requiredRoles.includes(role));
    return {
      phaseId,
      configured: roster.configured,
      version: roster.version,
      coverage,
      missingRoles: coverage.filter(({ covered }) => !covered).map(({ role }) => role),
    };
  }

  async replace(
    organizationId: string,
    role: string,
    projectId: string,
    dto: ReplaceProjectTeamDto,
  ) {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN)
      throw AppError.forbidden(
        'Only organization owners and administrators can edit the project team',
      );
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${organizationId} FOR NO KEY UPDATE
      `;
        if (!rows.length) throw AppError.notFound('Project', projectId);
        const existing = await tx.project.findFirstOrThrow({
          where: { id: projectId, organizationId },
          select: projectSelect,
        });
        if (existing.teamVersion !== dto.expectedVersion)
          throw AppError.conflict(
            ApiErrorCode.CONFLICT,
            'Project team version changed; reload before replacing it',
            { currentVersion: existing.teamVersion },
          );
        const agents = await tx.agent.findMany({
          where: {
            id: { in: dto.agentIds },
            organizationId,
            enabled: true,
            OR: [{ projectId: null }, { projectId }],
            provider: { organizationId, enabled: true },
          },
          select: { id: true },
        });
        if (agents.length !== dto.agentIds.length)
          throw AppError.validation(
            'Every team member must be an enabled agent in this project or organization with an enabled organization provider',
          );
        const ids = [...dto.agentIds].sort();
        if (
          existing.teamConfigured &&
          JSON.stringify(existing.teamMembers.map(({ agent }) => agent.id)) === JSON.stringify(ids)
        )
          return team(existing, organizationId, projectId);
        await tx.projectTeamMember.deleteMany({ where: { projectId } });
        if (ids.length)
          await tx.projectTeamMember.createMany({
            data: ids.map((agentId) => ({ projectId, agentId })),
          });
        const updated = await tx.project.update({
          where: { id: projectId },
          data: { teamConfigured: true, teamVersion: { increment: 1 } },
          select: projectSelect,
        });
        await this.audit.recordInTransaction(tx, {
          organizationId,
          projectId,
          action: AuditAction.CONFIGURATION_CHANGED,
          entityType: 'projectTeam',
          entityId: projectId,
          summary: 'Replaced project team',
          metadata: {
            agentIds: ids,
            previousVersion: existing.teamVersion,
            version: updated.teamVersion,
          },
        });
        return team(updated, organizationId, projectId);
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }
}
