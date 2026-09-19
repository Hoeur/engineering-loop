import { Injectable } from '@nestjs/common';
import { MemoryKind } from '@engloop/types';
import type { CreateArchitectureDecisionDto, UpsertProjectMemoryDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

/**
 * Versioned project memory + ADR store (spec section 16).
 *
 * Writing a memory kind never mutates the previous row: it deactivates it and
 * inserts version N+1, so an agent run can always be traced back to the exact
 * context it was given.
 */
@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, includeHistory = false) {
    const items = await this.prisma.projectMemory.findMany({
      where: { projectId, ...(includeHistory ? {} : { active: true }) },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    });
    return { items, meta: { kinds: Object.values(MemoryKind) } };
  }

  /** Flattened view used to build agent context. */
  async snapshot(projectId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.projectMemory.findMany({
      where: { projectId, active: true },
    });
    return Object.fromEntries(rows.map((row) => [row.kind, row.content]));
  }

  async upsert(projectId: string, dto: UpsertProjectMemoryDto) {
    const project = await this.prisma.project.count({ where: { id: projectId } });
    if (project === 0) throw AppError.notFound('Project', projectId);

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.projectMemory.findFirst({
        where: { projectId, kind: dto.kind },
        orderBy: { version: 'desc' },
      });

      if (latest) {
        await tx.projectMemory.updateMany({
          where: { projectId, kind: dto.kind },
          data: { active: false },
        });
      }

      return tx.projectMemory.create({
        data: {
          projectId,
          kind: dto.kind,
          version: (latest?.version ?? 0) + 1,
          active: true,
          content: dto.content,
          metadata: dto.metadata as Prisma.InputJsonValue,
        },
      });
    });
  }

  async listDecisions(projectId: string) {
    const items = await this.prisma.architectureDecision.findMany({
      where: { projectId },
      orderBy: { number: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });
    return { items, meta: {} };
  }

  async createDecision(dto: CreateArchitectureDecisionDto, authorId?: string) {
    const last = await this.prisma.architectureDecision.findFirst({
      where: { projectId: dto.projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    return this.prisma.architectureDecision.create({
      data: {
        projectId: dto.projectId,
        number: (last?.number ?? 0) + 1,
        title: dto.title,
        context: dto.context,
        decision: dto.decision,
        alternatives: dto.alternatives,
        consequences: dto.consequences,
        status: dto.status,
        authorId: authorId ?? null,
      },
    });
  }
}
