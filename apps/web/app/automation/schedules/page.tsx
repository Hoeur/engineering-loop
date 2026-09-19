'use client';

import * as React from 'react';
import { CalendarClock, Play } from 'lucide-react';
import { Badge, Button, Switch } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { absoluteTime, relativeTime, titleCase } from '@/lib/format';
import { useScheduleMutation, useSchedules } from '@/lib/queries';
import type { ScheduleSummary } from '@/lib/types';

export default function SchedulesPage(): React.JSX.Element {
  const schedules = useSchedules();
  const mutate = useScheduleMutation();

  const columns: Column<ScheduleSummary>[] = [
    {
      id: 'name',
      header: 'Schedule',
      primary: true,
      cell: (schedule) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{schedule.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {schedule.project?.name ?? '—'}
            {schedule.repository ? ` · ${schedule.repository.name}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (schedule) => <Badge tone="outline">{titleCase(schedule.type)}</Badge>,
    },
    {
      id: 'cron',
      header: 'Cron',
      cell: (schedule) => (
        <span className="font-mono text-xs">
          {schedule.cronExpression}
          <span className="ml-1 text-muted-foreground">{schedule.timezone}</span>
        </span>
      ),
    },
    {
      id: 'last',
      header: 'Last run',
      cell: (schedule) => (
        <span className="text-xs text-muted-foreground">
          {schedule.lastRunAt ? relativeTime(schedule.lastRunAt) : 'never'}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Next run',
      cell: (schedule) => (
        <span className="whitespace-nowrap text-xs">
          {schedule.enabled && schedule.nextRunAt ? absoluteTime(schedule.nextRunAt) : '—'}
        </span>
      ),
    },
    {
      id: 'enabled',
      header: 'Enabled',
      cell: (schedule) => (
        <Switch
          checked={schedule.enabled}
          aria-label={`Toggle ${schedule.name}`}
          onCheckedChange={(checked) =>
            mutate.mutate({ id: schedule.id, action: 'update', body: { enabled: checked } })
          }
        />
      ),
    },
    {
      id: 'actions',
      header: '',
      hideOnCard: true,
      cell: (schedule) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={() => mutate.mutate({ id: schedule.id, action: 'run' })}
        >
          <Play className="h-3 w-3" />
          Run now
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Cron-driven automation built on BullMQ repeatable jobs. A firing schedule creates a backlog task so every automated activity stays visible and auditable."
      />

      <QueryBoundary
        query={schedules}
        entity="Schedules"
        loadingLabel="Loading schedules…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={CalendarClock}
            title="No schedules"
            description="Create one with POST /api/schedules to run repository reviews, security scans or debt analysis on a cadence."
          />
        }
      >
        {(data) => (
          <DataTable columns={columns} rows={data.items} rowKey={(schedule) => schedule.id} />
        )}
      </QueryBoundary>
    </>
  );
}
