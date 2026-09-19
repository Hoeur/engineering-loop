'use client';

import type * as React from 'react';
import Link from 'next/link';
import { CalendarDays, CircleDollarSign, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Progress } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { MetricCard } from '@/components/common/metric-card';
import { QueryBoundary } from '@/components/common/states';
import { SimpleBarChart } from '@/components/common/simple-bar-chart';
import { formatCost, formatPercent, shortDate } from '@/lib/format';
import { useCosts, useCostsByTask } from '@/lib/queries';

export default function CostsPage(): React.JSX.Element {
  const costs = useCosts();
  const byTask = useCostsByTask();

  return (
    <>
      <PageHeader
        title="Costs"
        description="Estimated AI spend. Every agent run records provider, model, tokens and cost against its task, project and organization."
      />

      <QueryBoundary query={costs} entity="Costs" loadingLabel="Loading spend…">
        {(data) => (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Today" value={formatCost(data.today)} icon={CalendarDays} />
              <MetricCard label="This week" value={formatCost(data.thisWeek)} icon={CalendarDays} />
              <MetricCard
                label="This month"
                value={formatCost(data.thisMonth)}
                icon={CircleDollarSign}
                tone="info"
              />
              <MetricCard
                label="Budget used"
                value={formatPercent(data.budgetUsedPercent)}
                hint={`of ${formatCost(data.budgetUsd)}`}
                icon={Wallet}
                tone={data.budgetUsedPercent > 80 ? 'danger' : 'success'}
              />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Monthly budget</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress
                  value={Math.min(100, data.budgetUsedPercent)}
                  indicatorClassName={data.budgetUsedPercent > 80 ? 'bg-danger' : 'bg-success'}
                />
                <p className="text-xs text-muted-foreground">
                  {formatCost(data.thisMonth)} of {formatCost(data.budgetUsd)} used. A task that
                  exceeds its project budget stops before starting another agent run.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Spend per day</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleBarChart
                  barClassName="bg-accent"
                  data={data.byDay.slice(-14).map((row) => ({
                    label: shortDate(row.date),
                    value: row.cost,
                    formatted: formatCost(row.cost),
                  }))}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>By provider</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleBarChart
                    data={data.byProvider.map((row) => ({
                      label: row.providerKey,
                      value: row.cost,
                      formatted: formatCost(row.cost),
                    }))}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Most expensive tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  <QueryBoundary query={byTask} loadingLabel="Loading…">
                    {(rows) =>
                      rows.items.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          No task spend recorded yet.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {rows.items.map((row) => (
                            <li
                              key={row.taskId ?? 'unknown'}
                              className="flex items-center justify-between gap-2 py-2"
                            >
                              <span className="min-w-0 truncate text-xs">
                                {row.task ? (
                                  <Link
                                    href={`/engineering/tasks/${row.taskId ?? ''}`}
                                    className="hover:underline"
                                  >
                                    <span className="font-mono text-muted-foreground">
                                      {row.task.key}
                                    </span>{' '}
                                    {row.task.title}
                                  </Link>
                                ) : (
                                  'Unknown task'
                                )}
                              </span>
                              <span className="shrink-0 font-mono text-xs tabular-nums">
                                {formatCost(row.cost)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </QueryBoundary>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
