'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GitPullRequest } from 'lucide-react';
import { Badge } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { relativeTime, titleCase } from '@/lib/format';
import { useProjects, usePullRequests } from '@/lib/queries';
import type { PullRequestSummary } from '@/lib/types';

export default function PullRequestsPage(): React.JSX.Element {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>();
  const projects = useProjects();
  const pullRequests = usePullRequests({ projectId, status });

  const columns: Column<PullRequestSummary>[] = [
    {
      id: 'title',
      header: 'Pull request',
      primary: true,
      cell: (pr) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{pr.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {pr.headBranch} → {pr.baseBranch}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (pr) => (
        <Badge
          tone={pr.status === 'MERGED' ? 'success' : pr.status === 'CLOSED' ? 'neutral' : 'info'}
        >
          {titleCase(pr.status)}
        </Badge>
      ),
    },
    {
      id: 'repository',
      header: 'Repository',
      cell: (pr) => <span className="text-xs">{pr.repository?.name ?? '—'}</span>,
    },
    {
      id: 'task',
      header: 'Task',
      cell: (pr) => <span className="font-mono text-xs">{pr.task?.key ?? '—'}</span>,
    },
    {
      id: 'origin',
      header: 'Origin',
      cell: (pr) => (
        <Badge tone={pr.local ? 'warning' : 'success'}>
          {pr.local ? 'local record' : 'remote'}
        </Badge>
      ),
    },
    {
      id: 'created',
      header: 'Created',
      cell: (pr) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {relativeTime(pr.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Pull Requests"
        description="Pull requests opened by the agent loop. Without a configured remote, EngLoop records a local pull request so the workflow still completes end to end."
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
            id: 'status',
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: ['DRAFT', 'OPEN', 'MERGED', 'CLOSED'].map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setStatus(undefined);
        }}
      />

      <QueryBoundary
        query={pullRequests}
        entity="Pull requests"
        loadingLabel="Loading pull requests…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={GitPullRequest}
            title="No pull requests yet"
            description="Approve a task to open one. Projects below LEVEL_3_PR cannot open pull requests."
          />
        }
      >
        {(data) => (
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={(pr) => pr.id}
            onRowClick={(pr) => pr.task && router.push(`/engineering/tasks/${pr.task.id}`)}
          />
        )}
      </QueryBoundary>
    </>
  );
}
