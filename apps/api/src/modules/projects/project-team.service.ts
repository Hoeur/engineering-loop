import { Injectable } from '@nestjs/common';
import type { Prisma } from '@engloop/db';
import { ApiErrorCode, AuditAction, OrgRole, ProjectPhaseStatus, RunStatus } from '@engloop/types';
import type { AgentRole, ProjectTeam, ProjectTeamAgent, RoleCoverage } from '@engloop/types';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { ACTIVE_TASK_STATUSES } from '@engloop/workflow';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const agentSelect = {
  id: true,
  name: true,
  role: true,
  enabled: true,
  organizationId: true,
  projectId: true,
  provider: { select: { enabled: true, organizationId: true } },
  configurations: {
    where: { active: true },
    orderBy: { version: 'desc' as const },
    take: 1,
    select: { id: true, version: true },
  },
} as const;

function coverage(requiredRoles: AgentRole[], agents: ProjectTeamAgent[]): RoleCoverage {
  const covered = new Set(agents.filter((agent) => agent.eligible).map((agent) => agent.role));
  return {
    requiredRoles,
    coveredRoles: requiredRoles.filter((role) => covered.has(role)),
    missingRoles: requiredRoles.filter((role) => !covered.has(role)),
  };
}

@Injectable()
export class ProjectTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async isEditable(tx: Prisma.TransactionClient | PrismaService, projectId: string) {
    // Without execution snapshots, team edits must not change inputs of live work.
    const [phase, workflow, run, task] = await Promise.all([
      tx.projectPhase.findFirst({
        where: { projectId, status: ProjectPhaseStatus.ACTIVE },
        select: { id: true },
      }),
      tx.workflowRun.findFirst({
        where: {
          projectId,
          status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
        },
        select: { id: true },
      }),
      tx.agentRun.findFirst({
        where: { task: { projectId }, status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true },
      }),
      tx.task.findFirst({
        where: { projectId, status: { in: [...ACTIVE_TASK_STATUSES] } },
        select: { id: true },
      }),
    ]);
    return !phase && !workflow && !run && !task;
  }

  private async view(
    tx: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    projectId: string,
  ): Promise<ProjectTeam> {
    const project = await tx.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        teamConfigured: true,
        teamVersion: true,
        teamRequiredRoles: true,
        teamMembers: { select: { agentId: true } },
        phases: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, requiredRoles: true },
        },
      },
    });
    if (!project) throw AppError.notFound('Project', projectId);
    const memberIds = project.teamMembers.map((member) => member.agentId).sort();
    const rows = await tx.agent.findMany({
      where: { organizationId, OR: [{ projectId }, { projectId: null }] },
      orderBy: [{ role: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: agentSelect,
    });
    const agents = rows.map((agent): ProjectTeamAgent => {
      const unavailableReason = !agent.enabled
        ? 'Agent disabled'
        : !agent.provider.enabled || agent.provider.organizationId !== organizationId
          ? 'Provider unavailable'
          : null;
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        eligible: unavailableReason === null,
        unavailableReason,
        configuration: agent.configurations[0] ?? null,
      };
    });
    const members = agents.filter((agent) => memberIds.includes(agent.id));
    return {
      configured: project.teamConfigured,
      version: project.teamVersion,
      memberIds,
      agents,
      coverage: coverage(project.teamRequiredRoles, members),
      phases: project.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        ...coverage([...new Set([...project.teamRequiredRoles, ...phase.requiredRoles])], members),
      })),
      editable: await this.isEditable(tx, projectId),
    };
  }

  async read(organizationId: string, projectId: string) {
    return this.prisma.$transaction((tx) => this.view(tx, organizationId, projectId), {
      isolationLevel: 'RepeatableRead',
    });
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
        const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${organizationId} FOR NO KEY UPDATE`;
        if (!projects.length) throw AppError.notFound('Project', projectId);
        await tx.$queryRaw`SELECT id FROM tasks WHERE "projectId" = ${projectId} ORDER BY id FOR UPDATE`;
        if (!(await this.isEditable(tx, projectId)))
          throw AppError.conflict(
            ApiErrorCode.PHASE_LOCKED,
            'Reopen active phases and finish or stop live work before editing the team',
          );
        // Agent/provider edits must finish before eligibility is checked.
        await tx.$queryRaw`SELECT id FROM agents WHERE "organizationId" = ${organizationId} ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM agent_providers WHERE "organizationId" = ${organizationId} ORDER BY id FOR SHARE`;
        const current = await this.view(tx, organizationId, projectId);
        if (current.version !== dto.expectedVersion)
          throw AppError.conflict(
            ApiErrorCode.CONFLICT,
            'Project team changed; reload before saving',
            { currentVersion: current.version },
          );
        for (const id of dto.memberIds) {
          const agent = current.agents.find((candidate) => candidate.id === id);
          if (!agent) throw AppError.notFound('Eligible project agent', id);
          if (!agent.eligible)
            throw AppError.forbidden(`Agent ${id} is unavailable: ${agent.unavailableReason}`);
        }
        if (
          current.configured &&
          JSON.stringify(current.memberIds) === JSON.stringify([...dto.memberIds].sort()) &&
          JSON.stringify([...current.coverage.requiredRoles].sort()) ===
            JSON.stringify([...dto.requiredRoles].sort())
        )
          return current;
        await tx.projectTeamMember.deleteMany({ where: { projectId } });
        if (dto.memberIds.length)
          await tx.projectTeamMember.createMany({
            data: dto.memberIds.map((agentId) => ({ projectId, agentId })),
          });
        await tx.project.update({
          where: { id: projectId },
          data: {
            teamRequiredRoles: dto.requiredRoles,
            teamConfigured: true,
            teamVersion: { increment: 1 },
          },
        });
        await this.audit.recordInTransaction(tx, {
          organizationId,
          projectId,
          action: AuditAction.CONFIGURATION_CHANGED,
          entityType: 'projectTeam',
          entityId: projectId,
          summary: 'Replaced project team planning membership and required roles',
          metadata: { changes: dto },
        });
        return this.view(tx, organizationId, projectId);
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }
}
