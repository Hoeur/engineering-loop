'use client';

import type * as React from 'react';
import { Sliders } from 'lucide-react';
import { Badge } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { AgentBadge, ProviderBadge } from '@/components/common/badges';
import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import { useAgents, useCurrentUser } from '@/lib/queries';
import { AgentBudgetDialog } from '@/components/agents/agent-budget-dialog';
import type { AgentSummary } from '@/lib/types';

/** Mirrors the API's own gate, which is what actually enforces this. */
const canManageAgents = (role: string | undefined): boolean =>
  role === 'OWNER' || role === 'ADMIN';

export default function AgentConfigurationsPage(): React.JSX.Element {
  const agents = useAgents();
  const currentUser = useCurrentUser();
  const isAdmin = canManageAgents(currentUser.data?.role);

  const columns: Column<AgentSummary>[] = [
    {
      id: 'agent',
      header: 'Agent',
      primary: true,
      cell: (agent) => <AgentBadge name={agent.name} role={agent.role} />,
    },
    {
      id: 'provider',
      header: 'Provider',
      cell: (agent) => (
        <ProviderBadge providerKey={agent.provider.key} kind={agent.provider.kind} />
      ),
    },
    {
      id: 'model',
      header: 'Model',
      cell: (agent) => <span className="font-mono text-xs">{agent.model ?? '—'}</span>,
    },
    {
      id: 'permission',
      header: 'Permission',
      cell: (agent) => <Badge tone="outline">{agent.permissionLevel.replace(/_/g, ' ')}</Badge>,
    },
    { id: 'cost', header: 'Cost limit', cell: (agent) => formatCost(agent.maxCostUsd) },
    { id: 'tokens', header: 'Token limit', cell: (agent) => formatTokens(agent.maxTokens) },
    { id: 'timeout', header: 'Timeout', cell: (agent) => formatDuration(agent.timeoutMs) },
    { id: 'retries', header: 'Retries', cell: (agent) => agent.maxRetries },
    {
      id: 'commands',
      header: 'Allowed commands',
      hideOnCard: true,
      cell: (agent) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {agent.allowedCommands.length > 0
            ? agent.allowedCommands.join(', ')
            : 'inherits allowlist'}
        </span>
      ),
    },
    {
      id: 'enabled',
      header: 'State',
      cell: (agent) => (
        <Badge tone={agent.enabled ? 'success' : 'neutral'}>
          {agent.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      ),
    },
    ...(isAdmin
      ? [
          {
            id: 'actions',
            header: '',
            cell: (agent: AgentSummary) => <AgentBudgetDialog agent={agent} />,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Configurations"
        description="Per-agent execution limits: token budget, cost budget, timeout, retries, permission level and command allowlist. An agent's own limits bound its runs; unset ones fall back to the process defaults."
      />

      <QueryBoundary
        query={agents}
        entity="Agents"
        loadingLabel="Loading agent configurations…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Sliders}
            title="No agents configured"
            description="Seed demo data or create agents through POST /api/agents."
          />
        }
      >
        {(data) => <DataTable columns={columns} rows={data.items} rowKey={(agent) => agent.id} />}
      </QueryBoundary>
    </>
  );
}
