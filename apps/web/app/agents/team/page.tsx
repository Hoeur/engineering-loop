'use client';

import * as React from 'react';
import { Bot, ShieldCheck, Timer } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { AgentAvatar, ProviderBadge } from '@/components/common/badges';
import { formatCost, formatDuration, formatTokens, titleCase } from '@/lib/format';
import { useAgentTeam, useProjects, useSetRoleAssignments } from '@/lib/queries';

export default function AgentTeamPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const projects = useProjects();
  const team = useAgentTeam(projectId);
  const setAssignments = useSetRoleAssignments(projectId ?? '');

  return (
    <>
      <PageHeader
        title="Agent Team"
        description="Roles are never hardcoded to a vendor. Map each role to an agent; the workflow resolves the provider at run time."
        actions={
          <Select
            value={projectId ?? '__org__'}
            onValueChange={(value) => setProjectId(value === '__org__' ? undefined : value)}
          >
            <SelectTrigger className="w-[200px]" aria-label="Scope">
              <SelectValue placeholder="Organization defaults" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__org__">Organization defaults</SelectItem>
              {(projects.data?.items ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <QueryBoundary
        query={team}
        entity="Agent team"
        loadingLabel="Loading agent team…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={Bot} title="No agents configured" />}
      >
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((row) => (
              <Card key={row.role}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle>{titleCase(row.role)}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {row.candidates.length} candidate agent
                      {row.candidates.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {row.agent ? (
                    <Badge tone={row.agent.enabled ? 'success' : 'neutral'}>
                      {row.agent.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Unassigned</Badge>
                  )}
                </CardHeader>

                <CardContent className="space-y-3">
                  {row.agent ? (
                    <>
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={row.agent.name} className="h-8 w-8 text-xs" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.agent.name}</p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <ProviderBadge
                              providerKey={row.agent.provider.key}
                              kind={row.agent.provider.kind}
                            />
                            <span className="truncate font-mono text-[10px] text-muted-foreground">
                              {row.agent.model ?? row.agent.provider.defaultModel ?? 'default'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <dl className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <dt className="text-muted-foreground">Cost limit</dt>
                          <dd>{formatCost(row.agent.maxCostUsd)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Token limit</dt>
                          <dd>{formatTokens(row.agent.maxTokens)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Timeout</dt>
                          <dd className="inline-flex items-center gap-1">
                            <Timer className="h-3 w-3" />
                            {formatDuration(row.agent.timeoutMs)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Retries</dt>
                          <dd>{row.agent.maxRetries}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">Permission</dt>
                          <dd className="inline-flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            {row.agent.permissionLevel.replace(/_/g, ' ')}
                          </dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No agent is bound to this role. The workflow falls back to the organization's
                      default provider.
                    </p>
                  )}

                  {projectId && row.candidates.length > 0 ? (
                    <Select
                      value={row.agent?.id ?? '__none__'}
                      onValueChange={(value) =>
                        setAssignments.mutate([
                          { role: row.role, agentId: value === '__none__' ? null : value },
                        ])
                      }
                    >
                      <SelectTrigger aria-label={`Assign ${row.role}`}>
                        <SelectValue placeholder="Assign an agent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {row.candidates.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.name} · {candidate.provider.key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
