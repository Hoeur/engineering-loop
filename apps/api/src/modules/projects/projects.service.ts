import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  DomainEventName,
  OrgRole,
  RepositoryProvider,
  type TaskStatus,
} from '@engloop/types';
import type { CreateProjectDto, CreateRepositoryDto, UpdateProjectDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventBus } from '../../infrastructure/events/event-bus';
import { AppError } from '../../common/errors/app-error';
import { orderBy, paginate, skipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';

const SORTABLE = ['createdAt', 'updatedAt', 'name'] as const;
const MANAGER_ROLES = new Set<string>([OrgRole.OWNER, OrgRole.ADMIN]);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    page: number;
    pageSize: number;
    sortBy?: string;
    sortDir: 'asc' | 'desc';
    organizationId?: string;
    status?: string;
    search?: string;
  }) {
    const where: Prisma.ProjectWhereInput = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.status ? { status: query.status as Prisma.EnumProjectStatusFilter['equals'] } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: orderBy(query.sortBy, query.sortDir, SORTABLE, 'createdAt'),
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          repositories: { select: { id: true, name: true, provider: true, status: true } },
          _count: { select: { tasks: true, epics: true, schedules: true } },
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(organizationId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        organization: { select: { id: true, name: true, slug: true, defaultProviderKey: true } },
        repositories: true,
        epics: { include: { _count: { select: { tasks: true, features: true } } } },
        agents: { include: { provider: { select: { key: true, displayName: true, kind: true } } } },
        schedules: true,
        memories: { where: { active: true } },
        decisions: { orderBy: { number: 'desc' }, take: 20 },
        _count: { select: { tasks: true, workflowRuns: true } },
      },
    });
    if (!project) throw AppError.notFound('Project', id);

    const statusCounts = await this.prisma.task.groupBy({
      by: ['status'],
      where: { projectId: id },
      _count: { _all: true },
    });

    return {
      ...project,
      taskCountsByStatus: Object.fromEntries(
        statusCounts.map((row) => [row.status, row._count._all]),
      ) as Partial<Record<TaskStatus, number>>,
    };
  }

  async create(organizationId: string, role: string, dto: CreateProjectDto) {
    this.assertManager(role);
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name: dto.name,
        slug: dto.slug,
        key: dto.key,
        description: dto.description ?? null,
        permissionLevel: dto.permissionLevel,
        maxReviewCycles: dto.maxReviewCycles,
        maxTaskAttempts: dto.maxTaskAttempts,
        costBudgetUsd: dto.costBudgetUsd,
      },
    });

    this.events.publish(DomainEventName.PROJECT_CREATED, {
      projectId: project.id,
      name: project.name,
      slug: project.slug,
    });

    await this.audit.recordSafe({
      organizationId: project.organizationId,
      projectId: project.id,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'project',
      entityId: project.id,
      summary: `Created project ${project.name}`,
    });

    return project;
  }

  async update(organizationId: string, role: string, id: string, dto: UpdateProjectDto) {
    this.assertManager(role);
    const existing = await this.prisma.project.findFirst({ where: { id, organizationId } });
    if (!existing) throw AppError.notFound('Project', id);

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.permissionLevel !== undefined ? { permissionLevel: dto.permissionLevel } : {}),
        ...(dto.maxReviewCycles !== undefined ? { maxReviewCycles: dto.maxReviewCycles } : {}),
        ...(dto.maxTaskAttempts !== undefined ? { maxTaskAttempts: dto.maxTaskAttempts } : {}),
        ...(dto.costBudgetUsd !== undefined ? { costBudgetUsd: dto.costBudgetUsd } : {}),
      },
    });

    await this.audit.recordSafe({
      organizationId: project.organizationId,
      projectId: project.id,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'project',
      entityId: project.id,
      summary: `Updated project ${project.name}`,
      metadata: { changes: dto as Record<string, unknown> },
    });

    return project;
  }

  async listRepositories(organizationId: string, projectId: string) {
    await this.assertProject(organizationId, projectId);
    const items = await this.prisma.repository.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { tasks: true, worktrees: true, pullRequests: true } } },
    });
    return { items, meta: {} };
  }

  async addRepository(
    organizationId: string,
    role: string,
    projectId: string,
    dto: CreateRepositoryDto,
  ) {
    this.assertManager(role);
    if (dto.provider === RepositoryProvider.GITHUB || dto.installationId) {
      throw AppError.conflict(
        'GITHUB_IMPORT_REQUIRED',
        'GitHub repositories must be imported through the verified GitHub App flow',
      );
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true, organizationId: true },
    });
    if (!project) throw AppError.notFound('Project', projectId);

    const repository = await this.prisma.repository.create({
      data: {
        projectId,
        name: dto.name,
        provider: dto.provider,
        remoteUrl: dto.remoteUrl ?? null,
        localPath: dto.localPath ?? null,
        defaultBranch: dto.defaultBranch,
        primaryLanguage: dto.primaryLanguage ?? null,
        frameworks: dto.frameworks,
        packageManager: dto.packageManager,
        commands: dto.commands,
        installationId: dto.installationId ?? null,
      },
    });

    this.events.publish(DomainEventName.REPOSITORY_CONNECTED, {
      repositoryId: repository.id,
      projectId,
      provider: repository.provider,
      defaultBranch: repository.defaultBranch,
    });

    return repository;
  }

  /** Role → agent mapping used by the Agent Team screen (spec section 29). */
  async setRoleAssignments(
    organizationId: string,
    role: string,
    projectId: string,
    assignments: { role: string; agentId: string | null }[],
  ) {
    this.assertManager(role);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) throw AppError.notFound('Project', projectId);

    const assignedIds = [
      ...new Set(
        assignments
          .map((assignment) => assignment.agentId)
          .filter((agentId): agentId is string => agentId !== null),
      ),
    ];
    const agents =
      assignedIds.length > 0
        ? await this.prisma.agent.findMany({
            where: { id: { in: assignedIds } },
            select: { id: true, organizationId: true, projectId: true, role: true, enabled: true },
          })
        : [];
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const invalid = assignments.find((assignment) => {
      if (assignment.agentId === null) return false;
      const agent = agentsById.get(assignment.agentId);
      return (
        !agent ||
        agent.organizationId !== organizationId ||
        !agent.enabled ||
        agent.role !== assignment.role ||
        (agent.projectId !== null && agent.projectId !== projectId)
      );
    });
    if (invalid) {
      throw AppError.badRequest(
        'INVALID_ROLE_ASSIGNMENT',
        `Agent assignment for ${invalid.role} is not valid for this organization and project`,
      );
    }

    const current = { ...((project.roleAssignments ?? {}) as Record<string, string | null>) };
    for (const assignment of assignments) {
      if (assignment.agentId === null) delete current[assignment.role];
      else current[assignment.role] = assignment.agentId;
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { roleAssignments: current as Prisma.InputJsonValue },
    });

    await this.audit.recordSafe({
      organizationId: project.organizationId,
      projectId,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'project.roleAssignments',
      entityId: projectId,
      summary: 'Updated agent role assignments',
      metadata: { assignments },
    });

    return updated;
  }

  async assertProject(organizationId: string, projectId: string): Promise<void> {
    const count = await this.prisma.project.count({ where: { id: projectId, organizationId } });
    if (count === 0) throw AppError.notFound('Project', projectId);
  }

  private assertManager(role: string): void {
    if (!MANAGER_ROLES.has(role)) {
      throw AppError.forbidden('Only organization owners and administrators can manage projects');
    }
  }
}
