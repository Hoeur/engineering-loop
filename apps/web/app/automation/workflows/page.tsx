'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Workflow } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { RunStatusBadge } from '@/components/common/badges';
import { formatDuration, relativeTime, titleCase } from '@/lib/format';
import { useProjects, useWorkflowDefinitions, useWorkflowRuns } from '@/lib/queries';
import type { WorkflowRunSummary } from '@/lib/types';

interface DefinitionRow {
  key: string;
  name: string;
  description: string;
  version: number;
  steps: { key: string; title: string; kind: string; role: string | null }[];
}

export default function WorkflowsPage(): React.JSX.Element {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>();

  const projects = useProjects();
  const definitions = useWorkflowDefinitions();
  const runs = useWorkflowRuns({ projectId, status });

  const columns: Column<WorkflowRunSummary>[] = [
    {
      id: 'task',
      header: 'Run',
      primary: true,
      cell: (run) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {run.task ? `${run.task.key} · ${run.task.title}` : run.definitionKey}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">{run.definitionKey}</p>
        </div>
      ),
    },
    { id: 'status', header: 'Status', cell: (run) => <RunStatusBadge status={run.status} /> },
    {
      id: 'step',
      header: 'Current step',
      cell: (run) => (
        <span className="text-xs">{run.currentStepKey ? titleCase(run.currentStepKey) : '—'}</span>
      ),
    },
    {
      id: 'cycle',
      header: 'Cycle',
      cell: (run) => <span className="font-mono text-xs tabular-nums">{run.reviewCycle}</span>,
    },
    {
      id: 'steps',
      header: 'Steps',
      cell: (run) => <span className="font-mono text-xs">{run.steps.length}</span>,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (run) =>
        run.startedAt ? (
          <span className="text-xs">
            {formatDuration(
              (run.completedAt ? new Date(run.completedAt) : new Date()).getTime() -
                new Date(run.startedAt).getTime(),
            )}
          </span>
        ) : (
          '—'
        ),
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
        title="Workflows"
        description="Workflow definitions live in code (@engloop/workflow). This is their execution history."
      />

      <QueryBoundary query={definitions} loadingLabel="Loading definitions…">
        {(data) => (
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            {(data.items as unknown as DefinitionRow[]).map((definition) => (
              <Card key={definition.key}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{definition.name}</CardTitle>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {definition.key} · v{definition.version}
                    </p>
                  </div>
                  <Badge tone="info">orchestrator: {String(data.meta.orchestrator)}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">{definition.description}</p>
                  <ol className="flex flex-wrap gap-1">
                    {definition.steps.map((step, index) => (
                      <li key={step.key}>
                        <Badge tone="outline">
                          {index + 1}. {step.title}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

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
            id: 'status',
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: [
              'PENDING',
              'RUNNING',
              'SUCCEEDED',
              'FAILED',
              'CANCELLED',
              'WAITING_FOR_HUMAN',
            ].map((value) => ({ label: titleCase(value), value })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setStatus(undefined);
        }}
      />

      <QueryBoundary
        query={runs}
        entity="Workflow runs"
        loadingLabel="Loading workflow runs…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Workflow}
            title="No workflow runs"
            description="Start a task to create one."
            action={
              <Link href="/engineering/tasks" className="text-xs text-info-strong hover:underline">
                Go to tasks →
              </Link>
            }
          />
        }
      >
        {(data) => (
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={(run) => run.id}
            onRowClick={(run) => router.push(`/engineering/runs/${run.id}`)}
          />
        )}
      </QueryBoundary>
    </>
  );
}
