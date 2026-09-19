import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ownedAgentRunWhere,
  ownedTestRunWhere,
} from '../../common/tenant-ownership';
import { DashboardService } from './dashboard.service';

describe('DashboardService tenant aggregates', () => {
  it('filters agent, test, and finding aggregates through every owner', async () => {
    const agentGroupBy = vi.fn().mockResolvedValue([]);
    const agentFindMany = vi.fn().mockResolvedValue([]);
    const testGroupBy = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ total: 0n }]);
    const prisma = {
      project: { count: vi.fn().mockResolvedValue(0) },
      task: { count: vi.fn().mockResolvedValue(0) },
      testRun: { groupBy: testGroupBy },
      $queryRaw: queryRaw,
      costRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCost: null } }) },
      agentRun: { groupBy: agentGroupBy, findMany: agentFindMany },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    await new DashboardService(prisma).overview('org-1');

    expect(testGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: ownedTestRunWhere('org-1'),
    }));
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const findingQueries = queryRaw.mock.calls.map((args) =>
      args.flatMap((part) => {
        if (typeof part === 'string') return [part];
        if (Array.isArray(part)) return part;
        const strings = (part as { strings?: readonly string[] }).strings;
        return strings ? [...strings] : [];
      }).join(' '),
    );
    for (const query of findingQueries) {
      expect(query).toContain('review_findings');
      expect(query).toContain('f."taskId" IS NULL OR f."taskId" = r."taskId"');
      expect(query).toContain('s."taskId" IS NULL OR s."taskId" = r."taskId"');
    }
    expect(agentGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: ownedAgentRunWhere('org-1'),
    }));
    expect(agentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...ownedAgentRunWhere('org-1'), status: expect.any(Object) },
    }));
  });
});
