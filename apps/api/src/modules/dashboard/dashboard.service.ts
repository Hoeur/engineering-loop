import { Injectable } from '@nestjs/common';
import { AgentRunStatus, CheckStatus, ProjectStatus, TaskStatus } from '@engloop/types';
import { ACTIVE_TASK_STATUSES } from '@engloop/workflow';
import { Prisma, decimalToNumber } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ownedAgentRunWhere,
  ownedFindingSql,
  ownedTestRunWhere,
} from '../../common/tenant-ownership';

const startOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return startOfDay(date);
};

/** Backing queries for the Overview dashboard (spec section 25). */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string) {
    const scope = { project: { organizationId } };
    const weekAgo = daysAgo(6);
    const findingScope = ownedFindingSql(organizationId);
    const openFindingScope = Prisma.sql`${findingScope} AND f.status::text IN ('OPEN', 'FIXING')`;

    const [
      activeProjects,
      tasksRunning,
      tasksWaitingReview,
      tasksBlocked,
      tasksCompletedThisWeek,
      testRunAgg,
      openFindings,
      criticalFindings,
      spendThisMonth,
      agentRunStats,
      activeAgentRuns,
      recentActivity,
    ] = await Promise.all([
      this.prisma.project.count({ where: { organizationId, status: ProjectStatus.ACTIVE } }),
      this.prisma.task.count({ where: { ...scope, status: { in: [...ACTIVE_TASK_STATUSES] } } }),
      this.prisma.task.count({
        where: {
          ...scope,
          status: {
            in: [TaskStatus.REVIEWING, TaskStatus.NEEDS_HUMAN_REVIEW, TaskStatus.CHANGES_REQUESTED],
          },
        },
      }),
      this.prisma.task.count({
        where: { ...scope, status: { in: [TaskStatus.BLOCKED, TaskStatus.FAILED] } },
      }),
      this.prisma.task.count({
        where: { ...scope, status: TaskStatus.COMPLETED, completedAt: { gte: weekAgo } },
      }),
      this.prisma.testRun.groupBy({
        by: ['status'],
        where: ownedTestRunWhere(organizationId),
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total ${openFindingScope}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total ${openFindingScope}
          AND f.severity::text IN ('CRITICAL', 'HIGH')
      `,
      this.prisma.costRecord.aggregate({
        where: { organizationId, occurredOn: { gte: daysAgo(29) } },
        _sum: { estimatedCost: true },
      }),
      this.prisma.agentRun.groupBy({
        by: ['status'],
        where: ownedAgentRunWhere(organizationId),
        _count: { _all: true },
      }),
      this.prisma.agentRun.findMany({
        where: {
          ...ownedAgentRunWhere(organizationId),
          status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { task: { select: { id: true, key: true, title: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          summary: true,
          entityType: true,
          entityId: true,
          taskId: true,
          actorType: true,
          createdAt: true,
        },
      }),
    ]);

    const testsPassing =
      testRunAgg.find((row) => row.status === CheckStatus.PASSED)?._count._all ?? 0;
    const testsFailing =
      testRunAgg.find((row) => row.status === CheckStatus.FAILED)?._count._all ?? 0;

    const agentTotal = agentRunStats.reduce((sum, row) => sum + row._count._all, 0);
    const agentSucceeded =
      agentRunStats.find((row) => row.status === AgentRunStatus.SUCCEEDED)?._count._all ?? 0;

    return {
      cards: {
        activeProjects,
        tasksRunning,
        tasksWaitingReview,
        tasksBlocked,
        testsPassing,
        testsFailing,
        openReviewFindings: Number(openFindings[0]?.total ?? 0),
        criticalFindings: Number(criticalFindings[0]?.total ?? 0),
        spendThisMonthUsd: decimalToNumber(spendThisMonth._sum.estimatedCost),
        tasksCompletedThisWeek,
        agentSuccessRate: agentTotal > 0 ? Math.round((agentSucceeded / agentTotal) * 100) : 0,
        agentRunsTotal: agentTotal,
      },
      activeAgentRuns,
      recentActivity,
    };
  }

  /** Delivery metrics for the Insights section. */
  async deliveryMetrics(organizationId: string) {
    const completed = await this.prisma.task.findMany({
      where: {
        project: { organizationId },
        status: TaskStatus.COMPLETED,
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true, attemptCount: true, actualCost: true },
      take: 500,
      orderBy: { completedAt: 'desc' },
    });

    const durations = completed
      .map((task) =>
        task.completedAt && task.startedAt
          ? task.completedAt.getTime() - task.startedAt.getTime()
          : 0,
      )
      .filter((value) => value > 0)
      .sort((a, b) => a - b);

    const percentile = (p: number): number =>
      durations.length === 0
        ? 0
        : (durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))] ??
          0);

    const byStatus = await this.prisma.task.groupBy({
      by: ['status'],
      where: { project: { organizationId } },
      _count: { _all: true },
    });

    return {
      completedCount: completed.length,
      cycleTimeMs: {
        p50: percentile(50),
        p90: percentile(90),
        average:
          durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0,
      },
      averageAttempts:
        completed.length > 0
          ? Number(
              (
                completed.reduce((sum, task) => sum + task.attemptCount, 0) / completed.length
              ).toFixed(2),
            )
          : 0,
      averageCostUsd:
        completed.length > 0
          ? Number(
              (
                completed.reduce((sum, task) => sum + decimalToNumber(task.actualCost), 0) /
                completed.length
              ).toFixed(4),
            )
          : 0,
      tasksByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    };
  }
}
