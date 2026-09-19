import type { AuditAction } from '@engloop/types';
import { scrubSecrets, type EngLoopLogger } from '@engloop/logger';
import type { Prisma, PrismaClient } from '@engloop/db';

export interface AuditInput {
  organizationId: string;
  projectId?: string | null;
  taskId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  traceId?: string | null;
  actorType?: string;
  actorId?: string | null;
}

/** Worker-side audit writer. Never throws — auditing cannot fail a step. */
export class AuditWriter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: EngLoopLogger,
  ) {}

  async record(input: AuditInput): Promise<void> {
    try {
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
          actorType: input.actorType ?? 'AGENT',
          actorId: input.actorId ?? null,
          traceId: input.traceId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn({ error: String(error), action: input.action }, 'audit.write_failed');
    }
  }
}
