'use client';

import * as React from 'react';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { TestResultCard } from '@/components/run/check-cards';
import { relativeTime } from '@/lib/format';
import { useProjects, useTestRuns } from '@/lib/queries';

export default function TestsPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const projects = useProjects();
  const testRuns = useTestRuns({ projectId });

  return (
    <>
      <PageHeader
        title="Tests"
        description="Deterministic verification runs. EngLoop executes these commands itself and records the real exit codes — an agent cannot mark a check passed."
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
        ]}
        onReset={() => setProjectId(undefined)}
      />

      <QueryBoundary
        query={testRuns}
        entity="Test runs"
        loadingLabel="Loading check runs…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={FlaskConical}
            title="No check runs yet"
            description="Run a task, or trigger checks from a task's action bar."
          />
        }
      >
        {(data) => (
          <div className="space-y-4">
            {data.items.map((run) => (
              <Card key={run.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <CardTitle className="truncate">
                    {run.task ? (
                      <Link href={`/engineering/tasks/${run.task.id}`} className="hover:underline">
                        {run.task.key} · {run.task.title}
                      </Link>
                    ) : (
                      'Check run'
                    )}
                  </CardTitle>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeTime(run.completedAt ?? run.createdAt)}
                  </span>
                </CardHeader>
                <CardContent>
                  <TestResultCard run={run} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
