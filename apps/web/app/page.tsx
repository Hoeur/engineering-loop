'use client';

import type * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  CircleSlash,
  FlaskConical,
  Gauge,
  ScanEye,
  Timer,
  XCircle,
} from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { MetricCard } from '@/components/common/metric-card';
import { ActivityFeed } from '@/components/common/activity-feed';
import { AgentRunStatusBadge, AgentBadge } from '@/components/common/badges';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { formatCost, formatNumber, formatPercent, relativeTime } from '@/lib/format';
import { useOverview } from '@/lib/queries';

export default function OverviewPage(): React.JSX.Element {
  const overview = useOverview();

  return (
    <>
      <PageHeader
        title="Overview"
        description="What the agent fleet is doing right now, and what needs a human."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/engineering/tasks">Open task board</Link>
          </Button>
        }
      />

      <QueryBoundary query={overview} loadingLabel="Loading control-plane metrics…">
        {(data) => (
          <div className="space-y-5">
            <section
              aria-label="Key metrics"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
            >
              <MetricCard
                label="Active projects"
                value={formatNumber(data.cards.activeProjects)}
                icon={Boxes}
                href="/projects"
              />
              <MetricCard
                label="Tasks running"
                value={formatNumber(data.cards.tasksRunning)}
                icon={Activity}
                tone="info"
                href="/engineering/tasks"
              />
              <MetricCard
                label="Waiting for review"
                value={formatNumber(data.cards.tasksWaitingReview)}
                icon={ScanEye}
                tone={data.cards.tasksWaitingReview > 0 ? 'warning' : 'neutral'}
                href="/engineering/reviews"
              />
              <MetricCard
                label="Blocked"
                value={formatNumber(data.cards.tasksBlocked)}
                icon={CircleSlash}
                tone={data.cards.tasksBlocked > 0 ? 'danger' : 'neutral'}
                href="/engineering/tasks?status=BLOCKED"
              />
              <MetricCard
                label="Completed this week"
                value={formatNumber(data.cards.tasksCompletedThisWeek)}
                icon={CheckCircle2}
                tone="success"
              />

              <MetricCard
                label="Test runs passing"
                value={formatNumber(data.cards.testsPassing)}
                icon={FlaskConical}
                tone="success"
                href="/engineering/tests"
              />
              <MetricCard
                label="Test runs failing"
                value={formatNumber(data.cards.testsFailing)}
                icon={XCircle}
                tone={data.cards.testsFailing > 0 ? 'danger' : 'neutral'}
                href="/engineering/tests"
              />
              <MetricCard
                label="Open review findings"
                value={formatNumber(data.cards.openReviewFindings)}
                hint={`${formatNumber(data.cards.criticalFindings)} critical or high`}
                icon={AlertTriangle}
                tone={data.cards.criticalFindings > 0 ? 'danger' : 'warning'}
                href="/quality/bugs"
              />
              <MetricCard
                label="AI spend this month"
                value={formatCost(data.cards.spendThisMonthUsd)}
                icon={CircleDollarSign}
                href="/insights/costs"
              />
              <MetricCard
                label="Agent success rate"
                value={formatPercent(data.cards.agentSuccessRate)}
                hint={`${formatNumber(data.cards.agentRunsTotal)} runs recorded`}
                icon={Gauge}
                tone={data.cards.agentSuccessRate >= 80 ? 'success' : 'warning'}
                href="/insights/agent-performance"
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="min-w-0 lg:col-span-2">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Active agent runs</CardTitle>
                  <Link
                    href="/engineering/agent-runs"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View all
                  </Link>
                </CardHeader>
                <CardContent>
                  {data.activeAgentRuns.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No agent is running right now.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.activeAgentRuns.map((run) => (
                        <li key={run.id} className="py-2.5">
                          <Link
                            href={
                              run.task
                                ? `/engineering/tasks/${run.task.id}`
                                : '/engineering/agent-runs'
                            }
                            className="flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">
                                {run.task ? `${run.task.key} · ${run.task.title}` : run.role}
                              </p>
                              <div className="mt-1 flex items-center gap-2">
                                <AgentBadge
                                  name={run.agent?.name ?? run.providerKey}
                                  role={run.role}
                                />
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <AgentRunStatusBadge status={run.status} />
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Timer className="h-3 w-3" />
                                {relativeTime(run.startedAt ?? run.createdAt)}
                              </span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0 lg:col-span-3">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Recent activity</CardTitle>
                  <Link
                    href="/settings/audit"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Audit log
                  </Link>
                </CardHeader>
                <CardContent>
                  {data.recentActivity.length === 0 ? (
                    <EmptyState
                      title="No activity yet"
                      description="Run a task to see the engineering loop appear here."
                      className="border-0 shadow-none"
                    />
                  ) : (
                    <ActivityFeed entries={data.recentActivity} />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
