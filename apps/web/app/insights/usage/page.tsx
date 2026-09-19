'use client';

import type * as React from 'react';
import { BarChart3, Clock, Cpu, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { MetricCard } from '@/components/common/metric-card';
import { QueryBoundary } from '@/components/common/states';
import { SimpleBarChart, Sparkline } from '@/components/common/simple-bar-chart';
import { formatDuration, formatTokens, formatNumber, shortDate } from '@/lib/format';
import { useUsage } from '@/lib/queries';

export default function UsagePage(): React.JSX.Element {
  const usage = useUsage();

  return (
    <>
      <PageHeader
        title="Usage"
        description="Token consumption across the last 30 days, by day, provider and project."
      />

      <QueryBoundary query={usage} entity="Usage" loadingLabel="Loading usage…">
        {(data) => (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Agent runs" value={formatNumber(data.totals.runs)} icon={Layers} />
              <MetricCard
                label="Total tokens"
                value={formatTokens(data.totals.totalTokens)}
                icon={BarChart3}
                tone="info"
              />
              <MetricCard
                label="Cached tokens"
                value={formatTokens(data.totals.cachedTokens)}
                icon={Cpu}
                hint="reused context"
              />
              <MetricCard
                label="Agent time"
                value={formatDuration(data.totals.durationMs)}
                icon={Clock}
              />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Tokens per day</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-info">
                  <Sparkline values={data.byDay.map((row) => row.totalTokens)} />
                </div>
                <SimpleBarChart
                  data={data.byDay.slice(-14).map((row) => ({
                    label: shortDate(row.date),
                    value: row.totalTokens,
                    formatted: formatTokens(row.totalTokens),
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
                    barClassName="bg-accent"
                    data={data.byProvider.map((row) => ({
                      label: row.providerKey,
                      value: row.totalTokens,
                      formatted: formatTokens(row.totalTokens),
                    }))}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>By project</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleBarChart
                    barClassName="bg-success"
                    data={data.byProject.map((row) => ({
                      label: row.projectId?.slice(0, 8) ?? 'unassigned',
                      value: row.totalTokens,
                      formatted: formatTokens(row.totalTokens),
                    }))}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
