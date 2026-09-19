'use client';

import type * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { GitBranch, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { QueryBoundary, EmptyState } from '@/components/common/states';
import { TaskBoard } from '@/components/task/task-board';
import { NewTaskDialog } from '@/components/task/new-task-dialog';
import { MetricCard } from '@/components/common/metric-card';
import { formatCost, relativeTime, titleCase } from '@/lib/format';
import { useBoard, useProject } from '@/lib/queries';

export default function ProjectDetailPage(): React.JSX.Element {
  const params = useParams<{ projectId: string }>();
  const project = useProject(params.projectId);
  const board = useBoard(params.projectId);

  return (
    <QueryBoundary query={project} entity="Project" loadingLabel="Loading project…">
      {(data) => (
        <>
          <PageHeader
            breadcrumbs={
              <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Link href="/projects" className="hover:text-foreground">
                  Projects
                </Link>
                <span>/</span>
                <span className="font-mono">{data.key}</span>
              </nav>
            }
            title={data.name}
            description={data.description ?? undefined}
            actions={
              <div className="flex items-center gap-2">
                <Badge tone="outline">
                  <ShieldCheck className="h-3 w-3" />
                  {data.permissionLevel.replace(/_/g, ' ')}
                </Badge>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/engineering/tasks?projectId=${data.id}`}>All tasks</Link>
                </Button>
                <NewTaskDialog projectId={data.id} repositories={data.repositories ?? []} />
              </div>
            }
          />

          <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Tasks" value={data._count?.tasks ?? 0} />
            <MetricCard label="Repositories" value={data.repositories?.length ?? 0} />
            <MetricCard label="Max review cycles" value={data.maxReviewCycles} />
            <MetricCard label="Cost budget" value={formatCost(data.costBudgetUsd)} />
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Repositories</CardTitle>
              </CardHeader>
              <CardContent>
                {!data.repositories || data.repositories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No repositories connected.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.repositories.map((repository) => (
                      <li key={repository.id} className="py-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium">
                          <GitBranch className="h-3 w-3 shrink-0" />
                          <span className="truncate">{repository.name}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {repository.provider} · {repository.defaultBranch}
                          {repository.primaryLanguage ? ` · ${repository.primaryLanguage}` : ''}
                        </p>
                        {repository.lastAnalyzedAt ? (
                          <p className="text-[10px] text-muted-foreground">
                            analysed {relativeTime(repository.lastAnalyzedAt)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Tasks by status</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.taskCountsByStatus).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tasks yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.taskCountsByStatus).map(([status, count]) => (
                      <Badge key={status} tone="outline">
                        {titleCase(status)} · {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold">Board</h2>
          <QueryBoundary
            query={board}
            loadingLabel="Loading board…"
            emptyCheck={(payload) => payload.items.length === 0}
            empty={<EmptyState title="No tasks in this project yet" />}
          >
            {(payload) => <TaskBoard tasks={payload.items} />}
          </QueryBoundary>
        </>
      )}
    </QueryBoundary>
  );
}
