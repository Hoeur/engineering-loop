'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Columns3, List } from 'lucide-react';
import { Priority, TaskStatus, TaskType } from '@engloop/types';
import { Button, Tabs, TabsList, TabsTrigger } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { TaskBoard } from '@/components/task/task-board';
import { AgentBadge, CostBadge, PriorityBadge, StatusBadge } from '@/components/common/badges';
import { relativeTime, titleCase } from '@/lib/format';
import { useProjects, useTasks } from '@/lib/queries';
import type { TaskSummary } from '@/lib/types';

const toOptions = (values: readonly string[]) =>
  values.map((value) => ({ label: titleCase(value), value }));

export default function TasksPage(): React.JSX.Element {
  const router = useRouter();
  const [view, setView] = React.useState<'board' | 'list'>('board');
  const [search, setSearch] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>();
  const [priority, setPriority] = React.useState<string | undefined>();
  const [type, setType] = React.useState<string | undefined>();

  const projects = useProjects();
  const tasks = useTasks({
    search: search || undefined,
    projectId,
    status: status ? [status] : undefined,
    priority,
    type,
    pageSize: 200,
  });

  const columns: Column<TaskSummary>[] = [
    {
      id: 'key',
      header: 'Task',
      primary: true,
      cell: (task) => (
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground">{task.key}</span>
          <p className="truncate text-sm font-medium">{task.title}</p>
        </div>
      ),
    },
    { id: 'status', header: 'Status', cell: (task) => <StatusBadge status={task.status} /> },
    {
      id: 'priority',
      header: 'Priority',
      cell: (task) => <PriorityBadge priority={task.priority} />,
    },
    {
      id: 'repository',
      header: 'Repository',
      cell: (task) => <span className="text-xs">{task.repository?.name ?? '—'}</span>,
    },
    {
      id: 'agent',
      header: 'Agent',
      cell: (task) =>
        task.assignedAgent ? (
          <AgentBadge name={task.assignedAgent.name} role={task.assignedAgent.role} />
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'attempts',
      header: 'Attempts',
      cell: (task) => (
        <span className="font-mono text-xs tabular-nums">
          {task.attemptCount}/{task.maxAttempts}
        </span>
      ),
    },
    { id: 'cost', header: 'Cost', cell: (task) => <CostBadge value={task.actualCost} /> },
    {
      id: 'activity',
      header: 'Last activity',
      cell: (task) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {relativeTime(task.lastActivityAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every engineering task the agent fleet is working through."
        actions={
          <Tabs value={view} onValueChange={(value) => setView(value as 'board' | 'list')}>
            <TabsList>
              <TabsTrigger value="board" className="gap-1.5">
                <Columns3 className="h-3.5 w-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5">
                <List className="h-3.5 w-3.5" /> List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search key, title or description',
        }}
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
            options: toOptions(Object.values(TaskStatus)),
          },
          {
            id: 'priority',
            label: 'Priority',
            value: priority,
            onChange: setPriority,
            options: toOptions(Object.values(Priority)),
          },
          {
            id: 'type',
            label: 'Type',
            value: type,
            onChange: setType,
            options: toOptions(Object.values(TaskType)),
          },
        ]}
        onReset={() => {
          setSearch('');
          setProjectId(undefined);
          setStatus(undefined);
          setPriority(undefined);
          setType(undefined);
        }}
      />

      <QueryBoundary
        query={tasks}
        entity="Tasks"
        loadingLabel="Loading tasks…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No tasks match these filters"
            description="Adjust the filters, or create a task to start an engineering loop."
            action={
              <Button size="sm" variant="outline" onClick={() => router.push('/projects')}>
                Browse projects
              </Button>
            }
          />
        }
      >
        {(data) =>
          view === 'board' ? (
            <TaskBoard tasks={data.items} />
          ) : (
            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(task) => task.id}
              onRowClick={(task) => router.push(`/engineering/tasks/${task.id}`)}
            />
          )
        }
      </QueryBoundary>
    </>
  );
}
