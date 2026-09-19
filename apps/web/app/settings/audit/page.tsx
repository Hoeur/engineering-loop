'use client';

import * as React from 'react';
import { History } from 'lucide-react';
import { AuditAction } from '@engloop/types';
import { Card, CardContent } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { ActivityFeed } from '@/components/common/activity-feed';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { titleCase } from '@/lib/format';
import { useAuditLogs, useProjects } from '@/lib/queries';

export default function AuditPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [action, setAction] = React.useState<string | undefined>();
  const projects = useProjects();
  const logs = useAuditLogs({ projectId, action, pageSize: 100 });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every agent start/stop, command, task transition, git action, approval and configuration change."
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
            id: 'action',
            label: 'Action',
            value: action,
            onChange: setAction,
            options: Object.values(AuditAction).map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setAction(undefined);
        }}
      />

      <QueryBoundary
        query={logs}
        entity="Audit log"
        loadingLabel="Loading audit log…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={History} title="No audit entries match these filters" />}
      >
        {(data) => (
          <Card>
            <CardContent className="pt-4">
              <ActivityFeed entries={data.items} />
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </>
  );
}
