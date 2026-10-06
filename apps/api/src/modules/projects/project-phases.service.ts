import { Injectable } from '@nestjs/common';
import { AuditAction, OrgRole, TaskStatus } from '@engloop/types';
import type { Prisma } from '@engloop/db';
import type { CreateProjectPhaseDto, UpdateProjectPhaseDto } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import {
  ProjectPhaseDependenciesService,
  phaseSummary,
  phaseSummaryInclude,
} from './project-phase-dependencies.service';

const ACTIVE_STATUSES = [
  TaskStatus.PLANNING,
  TaskStatus.QUEUED,
  TaskStatus.IMPLEMENTING,
  TaskStatus.TESTING,
  TaskStatus.REVIEWING,
  TaskStatus.FIXING,
];
const summaryInclude = phaseSummaryInclude;

@Injectable()
export class ProjectPhasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dependencies: ProjectPhaseDependenciesService = new ProjectPhaseDependenciesService(),
  ) {}

  private transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation, { maxWait: 30_000, timeout: 30_000 });
  }

  private async project(
    tx: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    lock = false,
  ) {
    if (lock) {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (rows.length === 0) throw AppError.notFound('Project', projectId);
    } else if (
      !(await tx.project.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true },
      }))
    ) {
      throw AppError.notFound('Project', projectId);
    }
  }

  private manager(role: string) {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN)
      throw AppError.forbidden('Only organization owners and administrators can manage phases');
  }

  private async phase(tx: Prisma.TransactionClient, projectId: string, phaseId: string) {
    const phase = await tx.projectPhase.findFirst({
      where: { id: phaseId, projectId },
      include: summaryInclude,
    });
    if (!phase) throw AppError.notFound('Project phase', phaseId);
    return phaseSummary(phase);
  }

  private record(
    tx: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    entityId: string,
    summary: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.recordInTransaction(tx, {
      organizationId,
      projectId,
      entityId,
      entityType: 'projectPhase',
      action: AuditAction.CONFIGURATION_CHANGED,
      summary,
      metadata,
    });
  }

  async list(organizationId: string, projectId: string) {
    await this.project(this.prisma, organizationId, projectId);
    return {
      items: (
        await this.prisma.projectPhase.findMany({
          where: { projectId },
          orderBy: { position: 'asc' },
          include: summaryInclude,
        })
      ).map(phaseSummary),
      meta: {},
    };
  }

  async findOne(organizationId: string, projectId: string, phaseId: string) {
    await this.project(this.prisma, organizationId, projectId);
    const phase = await this.phase(this.prisma, projectId, phaseId);
    const tasks = await this.prisma.task.findMany({
      where: { projectId, phaseId },
      select: { id: true, key: true, title: true, status: true, phaseId: true },
      orderBy: { createdAt: 'asc' },
    });
    return { ...phase, tasks };
  }

  async create(
    organizationId: string,
    role: string,
    projectId: string,
    dto: CreateProjectPhaseDto,
  ) {
    this.manager(role);
    return this.transaction(async (tx) => {
      await this.project(tx, organizationId, projectId, true);
      const position = await tx.projectPhase.count({ where: { projectId } });
      if (position >= 500)
        throw AppError.badRequest('PHASE_LIMIT', 'A project supports at most 500 draft phases');
      const phase = await tx.projectPhase.create({
        data: {
          projectId,
          position,
          name: dto.name,
          description: dto.description ?? null,
          objective: dto.objective ?? null,
          deliverables: dto.deliverables ?? [],
          acceptanceCriteria: dto.acceptanceCriteria ?? [],
          requiredRoles: dto.requiredRoles ?? [],
        },
        include: summaryInclude,
      });
      if (dto.dependencyIds !== undefined)
        await this.dependencies.replace(tx, projectId, phase.id, dto.dependencyIds);
      await this.record(tx, organizationId, projectId, phase.id, 'Created draft project phase');
      return this.phase(tx, projectId, phase.id);
    });
  }

  async update(
    organizationId: string,
    role: string,
    projectId: string,
    phaseId: string,
    dto: UpdateProjectPhaseDto,
  ) {
    this.manager(role);
    return this.transaction(async (tx) => {
      await this.project(tx, organizationId, projectId, true);
      const existing = await this.phase(tx, projectId, phaseId);
      const { dependencyIds, ...metadata } = dto;
      const dependenciesChanged =
        dependencyIds === undefined
          ? false
          : await this.dependencies.replace(tx, projectId, phaseId, dependencyIds);
      const metadataChanged = Object.entries(metadata).some(
        ([key, value]) =>
          JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(value),
      );
      if (!dependenciesChanged && !metadataChanged) return existing;
      const phase = await tx.projectPhase.update({
        where: { id: phaseId },
        data: { ...metadata, updatedAt: new Date() },
        include: summaryInclude,
      });
      await this.record(tx, organizationId, projectId, phaseId, 'Updated draft project phase', {
        changes: dto,
      });
      return phaseSummary(phase);
    });
  }

  private async writeOrder(tx: Prisma.TransactionClient, projectId: string, ids: string[]) {
    const maximum = await tx.projectPhase.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    const offset = (maximum._max.position ?? -1) + 1;
    for (const [position, id] of ids.entries())
      await tx.projectPhase.update({ where: { id }, data: { position: offset + position } });
    for (const [position, id] of ids.entries())
      await tx.projectPhase.update({ where: { id }, data: { position } });
  }

  async order(organizationId: string, role: string, projectId: string, phaseIds: string[]) {
    this.manager(role);
    return this.transaction(async (tx) => {
      await this.project(tx, organizationId, projectId, true);
      const phases = await tx.projectPhase.findMany({ where: { projectId }, select: { id: true } });
      const expected = new Set(phases.map((phase) => phase.id));
      if (
        phaseIds.length !== expected.size ||
        new Set(phaseIds).size !== phaseIds.length ||
        phaseIds.some((id) => !expected.has(id))
      )
        throw AppError.badRequest(
          'INVALID_PHASE_ORDER',
          'Order must contain every phase in this project exactly once',
        );
      await this.writeOrder(tx, projectId, phaseIds);
      await this.record(
        tx,
        organizationId,
        projectId,
        projectId,
        'Reordered draft project phases',
        { phaseIds },
      );
      return {
        items: (
          await tx.projectPhase.findMany({
            where: { projectId },
            orderBy: { position: 'asc' },
            include: summaryInclude,
          })
        ).map(phaseSummary),
        meta: {},
      };
    });
  }

  private async assertEditableTask(
    tx: Prisma.TransactionClient,
    projectId: string,
    taskId: string,
  ) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM tasks WHERE id = ${taskId} AND "projectId" = ${projectId} FOR UPDATE`;
    if (rows.length === 0) throw AppError.notFound('Task', taskId);
    const task = await tx.task.findFirst({
      where: { id: taskId, projectId },
      select: {
        id: true,
        key: true,
        title: true,
        phaseId: true,
        status: true,
        workflowRuns: {
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          select: { id: true },
          take: 1,
        },
        agentRuns: {
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!task) throw AppError.notFound('Task', taskId);
    if (
      ACTIVE_STATUSES.some((status) => status === task.status) ||
      task.workflowRuns.length > 0 ||
      task.agentRuns.length > 0
    )
      throw AppError.conflict(
        'TASK_PHASE_LOCKED',
        'Phase membership cannot change while a task is queued or running',
      );
    return task;
  }

  async membership(
    organizationId: string,
    role: string,
    projectId: string,
    phaseId: string,
    taskId: string,
    link: boolean,
  ) {
    this.manager(role);
    return this.transaction(async (tx) => {
      await this.project(tx, organizationId, projectId, true);
      await this.phase(tx, projectId, phaseId);
      const task = await this.assertEditableTask(tx, projectId, taskId);
      if (!link && task.phaseId !== null && task.phaseId !== phaseId)
        throw AppError.conflict('TASK_PHASE_MISMATCH', 'Task belongs to another phase');
      if (task.phaseId === (link ? phaseId : null))
        return {
          id: task.id,
          key: task.key,
          title: task.title,
          status: task.status,
          phaseId: task.phaseId,
        };
      const updated = await tx.task.update({
        where: { id: taskId },
        data: { phaseId: link ? phaseId : null },
        select: { id: true, key: true, title: true, status: true, phaseId: true },
      });
      await this.record(
        tx,
        organizationId,
        projectId,
        phaseId,
        link ? 'Linked task to draft phase' : 'Unlinked task from draft phase',
        { taskId, previousPhaseId: task.phaseId, phaseId: updated.phaseId },
      );
      return updated;
    });
  }

  async delete(organizationId: string, role: string, projectId: string, phaseId: string) {
    this.manager(role);
    return this.transaction(async (tx) => {
      await this.project(tx, organizationId, projectId, true);
      await this.phase(tx, projectId, phaseId);
      await this.dependencies.assertDeletable(tx, projectId, phaseId);
      const tasks = await tx.task.findMany({
        where: { projectId, phaseId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const task of tasks) await this.assertEditableTask(tx, projectId, task.id);
      await tx.task.updateMany({ where: { projectId, phaseId }, data: { phaseId: null } });
      await tx.projectPhase.delete({ where: { id: phaseId } });
      const remaining = await tx.projectPhase.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await this.writeOrder(
        tx,
        projectId,
        remaining.map((phase) => phase.id),
      );
      await this.record(
        tx,
        organizationId,
        projectId,
        phaseId,
        'Deleted draft phase and preserved its tasks',
        { unlinkedTaskIds: tasks.map((task) => task.id) },
      );
      return { id: phaseId, deleted: true };
    });
  }
}
