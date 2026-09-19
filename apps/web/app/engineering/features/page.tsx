'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { titleCase } from '@/lib/format';
import { useFeatures, type FeatureRow } from '@/lib/collections';
import { useProjects } from '@/lib/queries';

export default function FeaturesPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const projects = useProjects();
  const features = useFeatures(projectId);

  const columns: Column<FeatureRow>[] = [
    {
      id: 'title',
      header: 'Feature',
      primary: true,
      cell: (feature) => <span className="text-sm font-medium">{feature.title}</span>,
    },
    {
      id: 'epic',
      header: 'Epic',
      cell: (feature) => <span className="text-xs">{feature.epic?.title ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (feature) => (
        <Badge tone={feature.status === 'COMPLETED' ? 'success' : 'info'}>
          {titleCase(feature.status)}
        </Badge>
      ),
    },
    {
      id: 'tasks',
      header: 'Tasks',
      cell: (feature) => <span className="font-mono text-xs">{feature._count?.tasks ?? 0}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      hideOnCard: true,
      cell: (feature) => (
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {feature.description ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Features" description="Deliverable slices inside an epic." />

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
        query={features}
        entity="Features"
        loadingLabel="Loading features…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={Sparkles} title="No features yet" />}
      >
        {(data) => (
          <DataTable columns={columns} rows={data.items} rowKey={(feature) => feature.id} />
        )}
      </QueryBoundary>
    </>
  );
}
