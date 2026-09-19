import { Injectable } from '@nestjs/common';
import { decimalToNumber, type Prisma } from '@engloop/db';
import type { UsageQuery } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const startOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return startOfDay(date);
};

@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string, query: UsageQuery) {
    const occurredOn = {
      gte: query.from ? startOfDay(new Date(query.from)) : daysAgo(29),
      lte: query.to ? startOfDay(new Date(query.to)) : startOfDay(new Date()),
    };
    const where: Prisma.CostRecordWhereInput = {
      organizationId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      occurredOn,
    };

    const [today, week, month, byDay, byProvider, byProject, budget] = await Promise.all([
      this.prisma.costRecord.aggregate({
        where: { organizationId, occurredOn: { gte: startOfDay(new Date()) } },
        _sum: { estimatedCost: true },
      }),
      this.prisma.costRecord.aggregate({
        where: { organizationId, occurredOn: { gte: daysAgo(6) } },
        _sum: { estimatedCost: true },
      }),
      this.prisma.costRecord.aggregate({
        where: { organizationId, occurredOn: { gte: daysAgo(29) } },
        _sum: { estimatedCost: true },
      }),
      this.prisma.costRecord.groupBy({
        by: ['occurredOn'],
        where,
        _sum: { estimatedCost: true },
        orderBy: { occurredOn: 'asc' },
      }),
      this.prisma.costRecord.groupBy({
        by: ['providerKey'],
        where,
        _sum: { estimatedCost: true },
        _count: { _all: true },
      }),
      this.prisma.costRecord.groupBy({
        by: ['projectId'],
        where,
        _sum: { estimatedCost: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { costBudgetUsd: true },
      }),
    ]);

    const monthSpend = decimalToNumber(month._sum.estimatedCost);
    const budgetUsd = decimalToNumber(budget?.costBudgetUsd);

    return {
      today: decimalToNumber(today._sum.estimatedCost),
      thisWeek: decimalToNumber(week._sum.estimatedCost),
      thisMonth: monthSpend,
      budgetUsd,
      budgetUsedPercent: budgetUsd > 0 ? Math.round((monthSpend / budgetUsd) * 100) : 0,
      byDay: byDay.map((row) => ({
        date: row.occurredOn.toISOString().slice(0, 10),
        cost: decimalToNumber(row._sum.estimatedCost),
      })),
      byProvider: byProvider.map((row) => ({
        providerKey: row.providerKey,
        cost: decimalToNumber(row._sum.estimatedCost),
        runs: row._count._all,
      })),
      byProject: byProject.map((row) => ({
        projectId: row.projectId,
        cost: decimalToNumber(row._sum.estimatedCost),
      })),
    };
  }

  async byTask(organizationId: string, limit = 20) {
    const rows = await this.prisma.costRecord.groupBy({
      by: ['taskId'],
      where: { organizationId, taskId: { not: null } },
      _sum: { estimatedCost: true },
      orderBy: { _sum: { estimatedCost: 'desc' } },
      take: limit,
    });

    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: rows.map((row) => row.taskId).filter((id): id is string => Boolean(id)) },
      },
      select: { id: true, key: true, title: true, status: true },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));

    return {
      items: rows.map((row) => ({
        taskId: row.taskId,
        task: row.taskId ? (byId.get(row.taskId) ?? null) : null,
        cost: decimalToNumber(row._sum.estimatedCost),
      })),
      meta: {},
    };
  }
}
