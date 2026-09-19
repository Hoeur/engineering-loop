'use client';

import type * as React from 'react';
import { Activity } from 'lucide-react';
import { Badge } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { ProviderBadge } from '@/components/common/badges';
import { formatCost, formatDuration, formatPercent, formatTokens, titleCase } from '@/lib/format';
import { useAgentPerformance } from '@/lib/queries';
import type { AgentPerformanceRow } from '@/lib/types';

export default function AgentPerformancePage(): React.JSX.Element {
  const performance = useAgentPerformance();

  const columns: Column<AgentPerformanceRow>[] = [
    {
      id: 'role',
      header: 'Role',
      primary: true,
      cell: (row) => <span className="text-sm font-medium">{titleCase(row.role)}</span>,
    },
    {
      id: 'provider',
      header: 'Provider',
      cell: (row) => <ProviderBadge providerKey={row.providerKey} />,
    },
    {
      id: 'runs',
      header: 'Runs',
      cell: (row) => <span className="font-mono text-xs">{row.total}</span>,
    },
    {
      id: 'success',
      header: 'Success rate',
      cell: (row) => (
        <Badge
          tone={row.successRate >= 80 ? 'success' : row.successRate >= 50 ? 'warning' : 'danger'}
        >
          {formatPercent(row.successRate)}
        </Badge>
      ),
    },
    {
      id: 'failed',
      header: 'Failed',
      cell: (row) => <span className="font-mono text-xs">{row.failed}</span>,
    },
    {
      id: 'duration',
      header: 'Avg duration',
      cell: (row) => <span className="text-xs">{formatDuration(row.avgDurationMs)}</span>,
    },
    {
      id: 'tokens',
      header: 'Tokens',
      cell: (row) => <span className="font-mono text-xs">{formatTokens(row.totalTokens)}</span>,
    },
    {
      id: 'cost',
      header: 'Cost',
      cell: (row) => <span className="font-mono text-xs">{formatCost(row.totalCost)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent Performance"
        description="Success rate, duration and spend per role and provider — the numbers you need to decide which agent should own which role."
      />

      <QueryBoundary
        query={performance}
        entity="Agent performance"
        loadingLabel="Loading agent performance…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Activity}
            title="No agent runs recorded"
            description="Run a task to start collecting performance data."
          />
        }
      >
        {(data) => (
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={(row) => `${row.role}:${row.providerKey}`}
          />
        )}
      </QueryBoundary>
    </>
  );
}
