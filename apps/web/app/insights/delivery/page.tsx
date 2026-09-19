'use client';

import type * as React from 'react';
import { CheckCircle2, Coins, RefreshCcw, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { MetricCard } from '@/components/common/metric-card';
import { QueryBoundary } from '@/components/common/states';
import { SimpleBarChart } from '@/components/common/simple-bar-chart';
import { formatCost, formatDuration, formatNumber, titleCase } from '@/lib/format';
import { useDeliveryMetrics } from '@/lib/queries';

export default function DeliveryMetricsPage(): React.JSX.Element {
  const metrics = useDeliveryMetrics();

  return (
    <>
      <PageHeader
        title="Delivery Metrics"
        description="How long a task takes from first agent run to completion, how many attempts it needs and what it costs."
      />

      <QueryBoundary
        query={metrics}
        entity="Delivery metrics"
        loadingLabel="Loading delivery metrics…"
      >
        {(data) => (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Completed tasks"
                value={formatNumber(data.completedCount)}
                icon={CheckCircle2}
                tone="success"
              />
              <MetricCard
                label="Cycle time p50"
                value={formatDuration(data.cycleTimeMs.p50)}
                hint={`p90 ${formatDuration(data.cycleTimeMs.p90)}`}
                icon={Timer}
              />
              <MetricCard
                label="Avg attempts"
                value={data.averageAttempts.toFixed(2)}
                icon={RefreshCcw}
                tone={data.averageAttempts > 2 ? 'warning' : 'neutral'}
              />
              <MetricCard
                label="Avg cost per task"
                value={formatCost(data.averageCostUsd)}
                icon={Coins}
              />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Tasks by status</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleBarChart
                  barClassName="bg-primary"
                  data={Object.entries(data.tasksByStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => ({
                      label: titleCase(status),
                      value: count,
                    }))}
                  emptyLabel="No tasks yet."
                />
              </CardContent>
            </Card>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
