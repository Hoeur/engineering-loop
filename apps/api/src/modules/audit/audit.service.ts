import { Injectable } from '@nestjs/common';
import { type AuditAction, type ApiMeta } from '@engloop/types';
import { scrubSecrets } from '@engloop/logger';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { getRequestContext } from '../../common/request-context';
import { paginate, skipTake, type Paginated } from '../../common/pagination';

export interface RecordAuditInput {
  organizationId: string;
  projectId?: string | null;
  taskId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  actorType?: string;
  actorId?: string | null;
  userId?: string | null;
}

export interface AuditQuery {
  organizationId?: string;
  projectId?: string;
  taskId?: string;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sortDir: 'asc' | 'desc';
}

/**
 * Append-only audit trail (spec section 21). Every agent start/stop, command,
 * task transition, git action, approval and configuration change lands here.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<void> {
    const ctx = getRequestContext();
    await this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: scrubSecrets(input.metadata ?? {}) as Prisma.InputJsonValue,
        actorType: input.actorType ?? ctx.actorType ?? 'SYSTEM',
        actorId: input.actorId ?? ctx.actorId ?? null,
        userId: input.userId ?? (ctx.actorType === 'USER' ? (ctx.actorId ?? null) : null),
        traceId: ctx.traceId,
      },
    });
  }

  /** Never throws — auditing must not be able to fail a business operation. */
  async recordSafe(input: RecordAuditInput): Promise<void> {
    try {
      await this.record(input);
    } catch {
      /* swallowed by design */
    }
  }

  async list(query: AuditQuery): Promise<Paginated<unknown> & { meta: ApiMeta }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.action ? { action: query.action as AuditAction } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: { createdAt: query.sortDir },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }
}
