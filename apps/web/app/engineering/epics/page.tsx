'use client';

import * as React from 'react';
import { Route } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { absoluteTime, titleCase } from '@/lib/format';
import { useEpics } from '@/lib/collections';
import { useProjects } from '@/lib/queries';

export default function EpicsPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const projects = useProjects();
  const epics = useEpics(projectId);

  return (
    <>
      <PageHeader title="Epics" description="Large bodies of work that group features and tasks." />

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
        ]}
        onReset={() => setProjectId(undefined)}
      />

      <QueryBoundary
        query={epics}
        entity="Epics"
        loadingLabel="Loading epics…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Route}
            title="No epics yet"
            description="Create one with POST /api/epics."
          />
        }
      >
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((epic) => (
              <Card key={epic.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <CardTitle className="truncate">{epic.title}</CardTitle>
                  <Badge tone={epic.status === 'COMPLETED' ? 'success' : 'info'}>
                    {titleCase(epic.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {epic.description ?? 'No description.'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {epic._count?.tasks ?? 0} tasks · {epic.features?.length ?? 0} features
                    {epic.targetDate ? ` · target ${absoluteTime(epic.targetDate)}` : ''}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
