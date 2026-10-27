import { Injectable } from '@nestjs/common';
import { agentEditNeedsVersion, type UpdateAgentDto, type UpsertAgentDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { ApiErrorCode, AuditAction, CheckStatus, RunStatus } from '@engloop/types';
import { ACTIVE_TASK_STATUSES } from '@engloop/workflow';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

const providerSelect = {
  id: true,
  key: true,
  displayName: true,
  kind: true,
  enabled: true,
  healthy: true,
  defaultModel: true,
} as const;

@Injectable()
export class AgentEditingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async read(organizationId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        role: true,
        model: true,
        enabled: true,
        projectId: true,
        systemPrompt: true,
        updatedAt: true,
        permissionLevel: true,
        allowedCommands: true,
        maxTokens: true,
        maxCostUsd: true,
        timeoutMs: true,
        maxRetries: true,
        provider: { select: providerSelect },
      },
    });
    if (!agent) throw AppError.notFound('Agent', id);
    return agent;
  }

  async create(organizationId: string, dto: UpsertAgentDto) {
    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.agentProvider.findUnique({
        where: { organizationId_key: { organizationId, key: dto.providerKey } },
      });
      if (!provider) throw AppError.notFound('AgentProvider', dto.providerKey);
      if (!provider.enabled) throw AppError.validation('Choose an enabled provider');
      if (
        dto.projectId &&
        !(await tx.project.findFirst({
          where: { id: dto.projectId, organizationId },
          select: { id: true },
        }))
      )
        throw AppError.notFound('Project', dto.projectId);
      const {
        organizationId: _organization,
        providerKey: _providerKey,
        configuration,
        ...fields
      } = dto;
      const agent = await tx.agent.create({
        data: {
          ...fields,
          organizationId,
          providerId: provider.id,
          model: dto.model?.trim() || provider.defaultModel,
          configurations: {
            create: { version: 1, values: configuration as Prisma.InputJsonValue, active: true },
          },
        },
        include: { provider: { select: providerSelect } },
      });
      await this.audit.recordInTransaction(tx, {
        organizationId,
        projectId: agent.projectId,
        action: AuditAction.CONFIGURATION_CHANGED,
        entityType: 'agent',
        entityId: agent.id,
        summary: `Created agent ${agent.name} (${agent.role}) on ${provider.key}`,
        actorType: 'USER',
      });
      return agent;
    });
  }

  async update(organizationId: string, id: string, dto: UpdateAgentDto) {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.agent.findFirst({
        where: { id, organizationId },
        select: { projectId: true },
      });
      if (!owned) throw AppError.notFound('Agent', id);
      const structural = [
        'role',
        'providerKey',
        'model',
        'systemPrompt',
        'permissionLevel',
        'allowedCommands',
      ].some((key) => key in dto);
      if (structural) {
        // Serialize with snapshot/team edits and legacy starts before locking agents.
        await tx.$queryRaw`SELECT id FROM projects WHERE "organizationId" = ${organizationId}
          AND (${owned.projectId}::text IS NULL OR id = ${owned.projectId}) ORDER BY id FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT t.id FROM tasks t JOIN projects p ON p.id = t."projectId"
          WHERE p."organizationId" = ${organizationId} AND (${owned.projectId}::text IS NULL OR p.id = ${owned.projectId})
          ORDER BY t.id FOR UPDATE OF t`;
      }
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const existing = await tx.agent.findUniqueOrThrow({ where: { id } });
      if (agentEditNeedsVersion(dto) && !dto.expectedUpdatedAt)
        throw AppError.validation(
          'Reload the agent and supply expectedUpdatedAt before changing settings',
        );
      if (dto.expectedUpdatedAt && existing.updatedAt.toISOString() !== dto.expectedUpdatedAt)
        throw AppError.conflict(ApiErrorCode.CONFLICT, 'Agent changed; reload before saving');
      if (structural) {
        const project = {
          organizationId,
          ...(existing.projectId ? { id: existing.projectId } : {}),
        };
        const [workflow, task, agentRun, review, tests] = await Promise.all([
          tx.workflowRun.findFirst({
            where: {
              project,
              status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
            },
            select: { id: true },
          }),
          tx.task.findFirst({
            where: { project, status: { in: [...ACTIVE_TASK_STATUSES] } },
            select: { id: true },
          }),
          tx.agentRun.findFirst({
            where: { task: { project }, status: { in: ['PENDING', 'RUNNING'] } },
            select: { id: true },
          }),
          tx.reviewRun.findFirst({
            where: { task: { project }, status: { in: [RunStatus.PENDING, RunStatus.RUNNING] } },
            select: { id: true },
          }),
          tx.testRun.findFirst({
            where: { task: { project }, status: { in: [CheckStatus.QUEUED, CheckStatus.RUNNING] } },
            select: { id: true },
          }),
        ]);
        if (workflow || task || agentRun || review || tests)
          throw AppError.conflict(
            ApiErrorCode.CONFLICT,
            'Finish or cancel active project work before changing agent execution settings',
          );
      }
      let providerId = existing.providerId;
      if (dto.providerKey) {
        const provider = await tx.agentProvider.findUnique({
          where: { organizationId_key: { organizationId, key: dto.providerKey } },
        });
        if (!provider) throw AppError.notFound('AgentProvider', dto.providerKey);
        if (!provider.enabled) throw AppError.validation('Choose an enabled provider');
        providerId = provider.id;
      }
      const { expectedUpdatedAt: _expected, providerKey: _key, ...fields } = dto;
      const agent = await tx.agent.update({
        where: { id },
        data: {
          ...fields,
          providerId,
          ...(dto.model !== undefined ? { model: dto.model.trim() || null } : {}),
          ...(dto.systemPrompt !== undefined ? { systemPrompt: dto.systemPrompt || null } : {}),
          updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
        },
        include: { provider: { select: providerSelect } },
      });
      await this.audit.recordInTransaction(tx, {
        organizationId,
        projectId: existing.projectId,
        action: AuditAction.CONFIGURATION_CHANGED,
        entityType: 'agent',
        entityId: id,
        summary: `Updated agent ${agent.name}`,
        actorType: 'USER',
        metadata: { fields: Object.keys(dto).filter((key) => key !== 'expectedUpdatedAt') },
      });
      return agent;
    });
  }
}
