'use client';

import type * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, Coins, FileCode2, FlaskConical, Timer } from 'lucide-react';
import { RunStatus } from '@engloop/types';
import { Button, Card, CardContent, CardHeader, CardTitle, Progress } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { QueryBoundary } from '@/components/common/states';
import { MetricCard } from '@/components/common/metric-card';
import { RunStatusBadge } from '@/components/common/badges';
import { RunTimeline } from '@/components/run/run-timeline';
import { formatCost, formatDuration, formatTokens, relativeTime } from '@/lib/format';
import { useWorkflowRun } from '@/lib/queries';

export default function LiveRunPage(): React.JSX.Element {
  const params = useParams<{ runId: string }>();
  const run = useWorkflowRun(params.runId);

  return (
    <QueryBoundary query={run} entity="Workflow run" loadingLabel="Loading run…">
      {(data) => {
        const agentRuns = data.steps.flatMap((step) => step.agentRuns ?? []);
        const testRuns = data.steps.flatMap((step) => step.testRuns ?? []);
        const totalTokens = agentRuns.reduce((sum, entry) => sum + entry.totalTokens, 0);
        const totalCost = agentRuns.reduce((sum, entry) => sum + Number(entry.estimatedCost), 0);
        const filesChanged = testRuns.length;
        const elapsed = data.startedAt
          ? (data.completedAt ? new Date(data.completedAt) : new Date()).getTime() -
            new Date(data.startedAt).getTime()
          : 0;
        const latestTestRun = testRuns[testRuns.length - 1];

        return (
          <>
            <PageHeader
              breadcrumbs={
                <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Link href="/automation/workflows" className="hover:text-foreground">
                    Workflows
                  </Link>
                  <span>/</span>
                  <span className="font-mono">{data.definitionKey}</span>
                </nav>
              }
              title={data.task ? `${data.task.key} · ${data.task.title}` : 'Workflow run'}
              description={`${data.definition.name} — review cycle ${String(data.reviewCycle)}, attempt ${String(data.attempt)}.`}
              actions={
                <div className="flex items-center gap-2">
                  <RunStatusBadge status={data.status} />
                  {data.task ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/engineering/tasks/${data.task.id}`}>Open task</Link>
                    </Button>
                  ) : null}
                </div>
              }
            />

            {data.error ? (
              <p className="mb-4 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger-strong">
                {data.error}
              </p>
            ) : null}

            <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <MetricCard
                label="Progress"
                value={`${data.progress.completed}/${data.progress.total}`}
                hint={`${String(data.progress.percent)}% complete`}
                icon={Activity}
                tone="info"
              />
              <MetricCard label="Elapsed" value={formatDuration(elapsed)} icon={Timer} />
              <MetricCard label="Tokens" value={formatTokens(totalTokens)} icon={FileCode2} />
              <MetricCard label="Cost" value={formatCost(totalCost)} icon={Coins} />
              <MetricCard
                label="Checks"
                value={
                  latestTestRun ? `${latestTestRun.passedChecks}/${latestTestRun.totalChecks}` : '—'
                }
                hint={latestTestRun ? (latestTestRun.passed ? 'passing' : 'failing') : 'not run'}
                icon={FlaskConical}
                tone={latestTestRun ? (latestTestRun.passed ? 'success' : 'danger') : 'neutral'}
              />
            </section>

            <div className="mb-5">
              <Progress
                value={data.progress.percent}
                indicatorClassName={
                  data.status === RunStatus.FAILED
                    ? 'bg-danger'
                    : data.status === RunStatus.SUCCEEDED
                      ? 'bg-success'
                      : 'bg-info'
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Engineering timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <RunTimeline run={data} />
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Agent runs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {agentRuns.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No agent has run yet.</p>
                    ) : (
                      <ul className="divide-y divide-border text-xs">
                        {agentRuns.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <span className="truncate">
                              {entry.role.toLowerCase()} · {entry.providerKey}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatDuration(entry.durationMs)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Step log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-[11px]">
                      {data.steps.map((step) => (
                        <li key={step.id} className="font-mono text-muted-foreground">
                          <span className="text-foreground">{step.stepKey}</span> · {step.status} ·{' '}
                          {step.finishedAt ? relativeTime(step.finishedAt) : 'in progress'}
                          {step.error ? (
                            <span className="block text-danger-strong">{step.error}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-muted-foreground">
              {filesChanged > 0 ? `${String(filesChanged)} verification pass(es) recorded. ` : ''}
              This view polls every 5 seconds.
            </p>
          </>
        );
      }}
    </QueryBoundary>
  );
}
