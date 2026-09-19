import { Injectable } from '@nestjs/common';
import type { UsageQuery } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const startOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return startOfDay(date);
};

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  private range(query: UsageQuery): { gte: Date; lte: Date } {
    return {
      gte: query.from ? startOfDay(new Date(query.from)) : daysAgo(29),
      lte: query.to ? startOfDay(new Date(query.to)) : startOfDay(new Date()),
    };
  }

  async summary(organizationId: string, query: UsageQuery) {
    const occurredOn = this.range(query);
    const where: Prisma.UsageRecordWhereInput = {
      organizationId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      occurredOn,
    };

    const [totals, byDay, byProvider, byProject] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where,
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          totalTokens: true,
          durationMs: true,
        },
        _count: { _all: true },
      }),
      this.prisma.usageRecord.groupBy({
        by: ['occurredOn'],
        where,
        _sum: { totalTokens: true, inputTokens: true, outputTokens: true },
        orderBy: { occurredOn: 'asc' },
      }),
      this.prisma.usageRecord.groupBy({
        by: ['providerKey'],
        where,
        _sum: { totalTokens: true },
        _count: { _all: true },
      }),
      this.prisma.usageRecord.groupBy({
        by: ['projectId'],
        where,
        _sum: { totalTokens: true },
        _count: { _all: true },
      }),
    ]);

    return {
      range: { from: occurredOn.gte.toISOString(), to: occurredOn.lte.toISOString() },
      totals: {
        runs: totals._count._all,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        cachedTokens: totals._sum.cachedTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        durationMs: totals._sum.durationMs ?? 0,
      },
      byDay: byDay.map((row) => ({
        date: row.occurredOn.toISOString().slice(0, 10),
        totalTokens: row._sum.totalTokens ?? 0,
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
      })),
      byProvider: byProvider.map((row) => ({
        providerKey: row.providerKey,
        totalTokens: row._sum.totalTokens ?? 0,
        runs: row._count._all,
      })),
      byProject: byProject.map((row) => ({
        projectId: row.projectId,
        totalTokens: row._sum.totalTokens ?? 0,
        runs: row._count._all,
      })),
    };
  }
}
