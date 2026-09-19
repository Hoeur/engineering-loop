import { Injectable } from '@nestjs/common';
import { AgentRole, AuditAction, OrgRole } from '@engloop/types';
import type { UpsertAgentDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAdministrator(role: string): void {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN) {
      throw AppError.forbidden('Only organization owners and administrators can manage agents');
    }
  }

  private redactProvider<T extends { provider: { encryptedCredential: string | null; credentialIv: string | null; credentialAuthTag: string | null } }>(agent: T) {
    const { encryptedCredential, credentialIv: _iv, credentialAuthTag: _tag, ...provider } = agent.provider;
    return { ...agent, provider: { ...provider, hasCredential: Boolean(encryptedCredential) } };
  }

  async list(filters: { organizationId?: string; projectId?: string; role?: string }) {
    const where: Prisma.AgentWhereInput = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.projectId ? { OR: [{ projectId: filters.projectId }, { projectId: null }] } : {}),
      ...(filters.role ? { role: filters.role as AgentRole } : {}),
    };
    const items = await this.prisma.agent.findMany({
      where,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      include: {
        provider: {
          select: {
            id: true,
            key: true,
            displayName: true,
            kind: true,
            healthy: true,
            defaultModel: true,
          },
        },
        _count: { select: { runs: true } },
      },
    });
    return { items, meta: {} };
  }

  /**
   * Agent Team view: every role, with the agent currently bound to it. Roles with
   * no agent render as "unassigned" rather than being hidden, so the gap is visible.
   */
  async team(organizationId: string, projectId?: string) {
    const { items } = await this.list({ organizationId, projectId });
    const project = projectId
      ? await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { roleAssignments: true },
        })
      : null;
    const assignments = (project?.roleAssignments ?? {}) as Record<string, string>;

    const roles = Object.values(AgentRole).map((role) => {
      const assignedId = assignments[role];
      const assigned =
        items.find((agent) => agent.id === assignedId) ??
        items.find((agent) => agent.role === role && agent.projectId === projectId) ??
        items.find((agent) => agent.role === role && agent.projectId === null) ??
        null;
      return { role, agent: assigned, candidates: items.filter((agent) => agent.role === role) };
    });

    return { items: roles, meta: { totalAgents: items.length } };
  }

  async findOne(organizationId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, organizationId },
      include: {
        provider: true,
        configurations: { orderBy: { version: 'desc' } },
        runs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!agent) throw AppError.notFound('Agent', id);
    return this.redactProvider(agent);
  }

  async create(organizationId: string, role: string, dto: UpsertAgentDto) {
    this.assertAdministrator(role);
    const provider = await this.prisma.agentProvider.findUnique({
      where: { organizationId_key: { organizationId, key: dto.providerKey } },
    });
    if (!provider) throw AppError.notFound('AgentProvider', dto.providerKey);
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId }, select: { id: true } });
      if (!project) throw AppError.notFound('Project', dto.projectId);
    }

    const agent = await this.prisma.agent.create({
      data: {
        organizationId,
        projectId: dto.projectId ?? null,
        providerId: provider.id,
        name: dto.name,
        role: dto.role,
        model: dto.model ?? provider.defaultModel,
        enabled: dto.enabled,
        systemPrompt: dto.systemPrompt ?? null,
        maxTokens: dto.maxTokens,
        maxCostUsd: dto.maxCostUsd,
        timeoutMs: dto.timeoutMs,
        maxRetries: dto.maxRetries,
        permissionLevel: dto.permissionLevel,
        allowedCommands: dto.allowedCommands,
        configurations: {
          create: { version: 1, values: dto.configuration as Prisma.InputJsonValue, active: true },
        },
      },
      include: { provider: true },
    });

    await this.audit.recordSafe({
      organizationId,
      projectId: dto.projectId ?? null,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'agent',
      entityId: agent.id,
      summary: `Created agent ${agent.name} (${agent.role}) on ${provider.key}`,
    });

    return this.redactProvider(agent);
  }

  async update(organizationId: string, role: string, id: string, dto: Partial<UpsertAgentDto>) {
    this.assertAdministrator(role);
    const existing = await this.prisma.agent.findFirst({ where: { id, organizationId } });
    if (!existing) throw AppError.notFound('Agent', id);

    let providerId = existing.providerId;
    if (dto.providerKey) {
      const provider = await this.prisma.agentProvider.findUnique({
        where: {
          organizationId_key: { organizationId: existing.organizationId, key: dto.providerKey },
        },
      });
      if (!provider) throw AppError.notFound('AgentProvider', dto.providerKey);
      providerId = provider.id;
    }

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        providerId,
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.systemPrompt !== undefined ? { systemPrompt: dto.systemPrompt } : {}),
        ...(dto.maxTokens !== undefined ? { maxTokens: dto.maxTokens } : {}),
        ...(dto.maxCostUsd !== undefined ? { maxCostUsd: dto.maxCostUsd } : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.maxRetries !== undefined ? { maxRetries: dto.maxRetries } : {}),
        ...(dto.permissionLevel !== undefined ? { permissionLevel: dto.permissionLevel } : {}),
        ...(dto.allowedCommands !== undefined ? { allowedCommands: dto.allowedCommands } : {}),
      },
      include: { provider: true },
    });

    await this.audit.recordSafe({
      organizationId: existing.organizationId,
      projectId: existing.projectId,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'agent',
      entityId: id,
      summary: `Updated agent ${agent.name}`,
      metadata: { changes: dto as Record<string, unknown> },
    });

    return this.redactProvider(agent);
  }

  /** Agent performance panel on the Insights screens (spec section 31). */
  async performance(organizationId: string) {
    const grouped = await this.prisma.agentRun.groupBy({
      by: ['role', 'providerKey', 'status'],
      where: { task: { project: { organizationId } } },
      _count: { _all: true },
      _avg: { durationMs: true },
      _sum: { totalTokens: true, estimatedCost: true },
    });

    const byRole = new Map<
      string,
      {
        role: string;
        providerKey: string;
        total: number;
        succeeded: number;
        failed: number;
        avgDurationMs: number;
        totalTokens: number;
        totalCost: number;
      }
    >();

    for (const row of grouped) {
      const key = `${row.role}:${row.providerKey}`;
      const entry = byRole.get(key) ?? {
        role: row.role,
        providerKey: row.providerKey,
        total: 0,
        succeeded: 0,
        failed: 0,
        avgDurationMs: 0,
        totalTokens: 0,
        totalCost: 0,
      };
      entry.total += row._count._all;
      if (row.status === 'SUCCEEDED') entry.succeeded += row._count._all;
      if (row.status === 'FAILED' || row.status === 'TIMED_OUT') entry.failed += row._count._all;
      entry.avgDurationMs = Math.round(row._avg.durationMs ?? entry.avgDurationMs);
      entry.totalTokens += row._sum.totalTokens ?? 0;
      entry.totalCost += Number(row._sum.estimatedCost ?? 0);
      byRole.set(key, entry);
    }

    const items = [...byRole.values()].map((entry) => ({
      ...entry,
      successRate: entry.total > 0 ? Math.round((entry.succeeded / entry.total) * 100) : 0,
    }));

    return { items, meta: {} };
  }
}
