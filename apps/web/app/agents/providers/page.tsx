'use client';

import type * as React from 'react';
import { Cpu, ShieldAlert } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { relativeTime, titleCase } from '@/lib/format';
import { useProviders } from '@/lib/queries';

export default function ProvidersPage(): React.JSX.Element {
  const providers = useProviders();

  return (
    <>
      <PageHeader
        title="Providers"
        description="Registered coding-agent providers. Real provider authentication comes from the worker process environment."
      />

      <QueryBoundary
        query={providers}
        entity="Providers"
        loadingLabel="Loading providers…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={Cpu} title="No providers configured" />}
      >
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((provider) => (
              <Card key={provider.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{provider.displayName}</CardTitle>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {provider.key}
                    </p>
                  </div>
                  <Badge tone={provider.enabled ? 'success' : 'neutral'}>
                    {provider.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="outline">{titleCase(provider.kind)}</Badge>
                    <Badge tone={provider.healthy ? 'success' : 'danger'}>
                      {provider.healthy ? 'Healthy' : 'Unhealthy'}
                    </Badge>
                    <Badge tone="info">
                      {provider.credentialSource === 'none' ? 'Offline provider' : 'Worker auth'}
                    </Badge>
                  </div>

                  <dl className="space-y-1 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Default model</dt>
                      <dd className="truncate font-mono">{provider.defaultModel ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Agents bound</dt>
                      <dd>{provider._count?.agents ?? 0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Runs</dt>
                      <dd>{provider._count?.agentRuns ?? 0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Last probe</dt>
                      <dd>
                        {provider.lastHealthCheckAt
                          ? relativeTime(provider.lastHealthCheckAt)
                          : '—'}
                      </dd>
                    </div>
                  </dl>

                  {provider.lastHealthDetail ? (
                    <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {provider.lastHealthDetail}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
