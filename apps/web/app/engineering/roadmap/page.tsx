'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Map as MapIcon } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { StatusBadge } from '@/components/common/badges';
import { useProjects, useTasks } from '@/lib/queries';

/** Now / Next / Later, derived from task status rather than a separate field. */
const LANES = [
  {
    id: 'now',
    title: 'Now',
    match: (status: string) =>
      ['IMPLEMENTING', 'IMPLEMENTATION_READY', 'TESTING', 'REVIEWING', 'FIXING', 'QUEUED'].includes(
        status,
      ),
  },
  {
    id: 'next',
    title: 'Next',
    match: (status: string) => ['PLANNING', 'PLAN_READY', 'BACKLOG'].includes(status),
  },
  {
    id: 'later',
    title: 'Blocked & escalated',
    match: (status: string) =>
      ['BLOCKED', 'FAILED', 'NEEDS_HUMAN_REVIEW', 'CHANGES_REQUESTED', 'TEST_FAILED'].includes(
        status,
      ),
  },
  {
    id: 'done',
    title: 'Shipped',
    match: (status: string) =>
      ['APPROVED', 'PR_READY', 'PR_CREATED', 'MERGED', 'COMPLETED'].includes(status),
  },
];

export default function RoadmapPage(): React.JSX.Element {
  const projects = useProjects();
  const tasks = useTasks({ pageSize: 200 });

  return (
    <>
      <PageHeader
        title="Roadmap"
        description="Delivery view across every project: what is moving now, what is queued, and what is waiting on a human."
      />

      <QueryBoundary query={projects} loadingLabel="Loading projects…">
        {(projectData) => (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projectData.items.map((project) => (
              <Card key={project.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="truncate">{project.name}</CardTitle>
                  <Badge tone="outline">{project.key}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {project._count?.tasks ?? 0} tasks · {project._count?.epics ?? 0} epics
                  </p>
                  <Progress value={Math.min(100, (project._count?.tasks ?? 0) * 8)} />
                  <Link
                    href={`/projects/${project.id}`}
                    className="inline-block text-xs text-info-strong hover:underline"
                  >
                    Open board →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

      <QueryBoundary
        query={tasks}
        entity="Roadmap"
        loadingLabel="Loading roadmap…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={MapIcon} title="Nothing on the roadmap yet" />}
      >
        {(data) => (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {LANES.map((lane) => {
              const items = data.items.filter((task) => lane.match(task.status));
              return (
                <section key={lane.id} className="rounded-lg border border-border bg-card">
                  <header className="flex items-center justify-between border-b border-border px-3 py-2">
                    <h2 className="text-xs font-semibold">{lane.title}</h2>
                    <Badge tone="outline">{items.length}</Badge>
                  </header>
                  <ul className="divide-y divide-border">
                    {items.length === 0 ? (
                      <li className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                        Empty
                      </li>
                    ) : (
                      items.slice(0, 12).map((task) => (
                        <li key={task.id}>
                          <Link
                            href={`/engineering/tasks/${task.id}`}
                            className="block px-3 py-2 hover:bg-muted/50"
                          >
                            <p className="truncate text-xs font-medium">{task.title}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {task.key}
                              </span>
                              <StatusBadge status={task.status} />
                            </div>
                          </Link>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
