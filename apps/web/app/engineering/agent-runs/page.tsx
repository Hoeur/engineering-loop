'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import { AgentRole, AgentRunStatus } from '@engloop/types';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import {
  AgentBadge,
  AgentRunStatusBadge,
  CostBadge,
  ProviderBadge,
} from '@/components/common/badges';
import { formatDuration, formatTokens, relativeTime, titleCase } from '@/lib/format';
import { useAgentRuns, useProjects } from '@/lib/queries';
import type { AgentRunSummary } from '@/lib/types';

export default function AgentRunsPage(): React.JSX.Element {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [role, setRole] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>();

  const projects = useProjects();
  const runs = useAgentRuns({ projectId, role, status });

  const columns: Column<AgentRunSummary>[] = [
    {
      id: 'task',
      header: 'Task',
      primary: true,
      cell: (run) =>
        run.task ? (
          <div className="min-w-0">
            <span className="font-mono text-[11px] text-muted-foreground">{run.task.key}</span>
            <p className="truncate text-sm">{run.task.title}</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'agent',
      header: 'Agent',
      cell: (run) => <AgentBadge name={run.agent?.name ?? run.providerKey} role={run.role} />,
    },
    {
      id: 'provider',
      header: 'Provider',
      cell: (run) => <ProviderBadge providerKey={run.providerKey} />,
    },
    { id: 'status', header: 'Status', cell: (run) => <AgentRunStatusBadge status={run.status} /> },
    {
      id: 'tokens',
      header: 'Tokens',
      cell: (run) => <span className="font-mono text-xs">{formatTokens(run.totalTokens)}</span>,
    },
    { id: 'cost', header: 'Cost', cell: (run) => <CostBadge value={run.estimatedCost} /> },
    {
      id: 'duration',
      header: 'Duration',
      cell: (run) => <span className="text-xs">{formatDuration(run.durationMs)}</span>,
    },
    {
      id: 'started',
      header: 'Started',
      cell: (run) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {relativeTime(run.startedAt ?? run.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent Runs"
        description="Every agent execution, with its provider, token usage, cost and outcome."
      />

      <FilterBar
        filters={[
          {
            id: 'project',
            label: 'Project',
            value: projectId,
            onChange: setProjectId,
            options: (projects.data?.items ?? []).map((project) => ({
              label: project.name,
              value: project.id,
            })),
          },
          {
            id: 'role',
            label: 'Role',
            value: role,
            onChange: setRole,
            options: Object.values(AgentRole).map((value) => ({ label: titleCase(value), value })),
          },
          {
            id: 'status',
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: Object.values(AgentRunStatus).map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setRole(undefined);
          setStatus(undefined);
        }}
      />

      <QueryBoundary
        query={runs}
        entity="Agent runs"
        loadingLabel="Loading agent runs…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Activity}
            title="No agent runs"
            description="Start a task to see planner, implementer and reviewer executions here."
          />
        }
      >
        {(data) => (
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={(run) => run.id}
            onRowClick={(run) => run.task && router.push(`/engineering/tasks/${run.task.id}`)}
          />
        )}
      </QueryBoundary>
    </>
  );
}
