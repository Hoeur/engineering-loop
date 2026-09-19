import type * as React from 'react';
import type {
  AgentRunStatus,
  CheckStatus,
  Priority,
  RiskLevel,
  RunStatus,
  Severity,
  TaskStatus,
} from '@engloop/types';
import { Badge, cn } from '@engloop/ui';
import { titleCase, formatCost, initials } from '@/lib/format';
import {
  AGENT_RUN_TONE,
  CHECK_STATUS_TONE,
  FINDING_STATUS_TONE,
  PRIORITY_TONE,
  PROVIDER_TONE,
  RISK_TONE,
  RUN_STATUS_TONE,
  SEVERITY_TONE,
  TASK_STATUS_TONE,
} from '@/lib/status';

export const StatusBadge = ({ status }: { status: TaskStatus }): React.JSX.Element => (
  <Badge tone={TASK_STATUS_TONE[status]}>{titleCase(status)}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }): React.JSX.Element => (
  <Badge tone={PRIORITY_TONE[priority]}>{titleCase(priority)}</Badge>
);

export const RiskBadge = ({ risk }: { risk: RiskLevel }): React.JSX.Element => (
  <Badge tone={RISK_TONE[risk]}>{titleCase(risk)} risk</Badge>
);

export const SeverityBadge = ({ severity }: { severity: Severity }): React.JSX.Element => (
  <Badge tone={SEVERITY_TONE[severity]}>{titleCase(severity)}</Badge>
);

export const RunStatusBadge = ({ status }: { status: RunStatus }): React.JSX.Element => (
  <Badge tone={RUN_STATUS_TONE[status]}>{titleCase(status)}</Badge>
);

export const AgentRunStatusBadge = ({ status }: { status: AgentRunStatus }): React.JSX.Element => (
  <Badge tone={AGENT_RUN_TONE[status]}>{titleCase(status)}</Badge>
);

export const CheckStatusBadge = ({ status }: { status: CheckStatus }): React.JSX.Element => (
  <Badge tone={CHECK_STATUS_TONE[status]}>{titleCase(status)}</Badge>
);

export const FindingStatusBadge = ({ status }: { status: string }): React.JSX.Element => (
  <Badge tone={FINDING_STATUS_TONE[status] ?? 'neutral'}>{titleCase(status)}</Badge>
);

export const ProviderBadge = ({
  providerKey,
  kind,
}: {
  providerKey: string;
  kind?: string;
}): React.JSX.Element => (
  <Badge tone={PROVIDER_TONE[kind ?? providerKey.toUpperCase()] ?? 'neutral'}>{providerKey}</Badge>
);

export const CostBadge = ({ value }: { value: string | number }): React.JSX.Element => (
  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatCost(value)}</span>
);

export const AgentAvatar = ({
  name,
  className,
}: {
  name: string;
  className?: string;
}): React.JSX.Element => (
  <span
    className={cn(
      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[10px] font-semibold text-accent-strong ring-1 ring-inset ring-accent/20',
      className,
    )}
    aria-hidden
  >
    {initials(name)}
  </span>
);

export const AgentBadge = ({ name, role }: { name: string; role?: string }): React.JSX.Element => (
  // `flex` (not `inline-flex`) plus `min-w-0` on both levels: without them the
  // text child keeps its automatic minimum width and overlaps whatever sits
  // beside it on a narrow board card instead of truncating.
  <span className="flex min-w-0 items-center gap-1.5">
    <AgentAvatar name={name} />
    <span className="min-w-0 truncate text-xs">
      {name}
      {role ? <span className="text-muted-foreground"> · {titleCase(role)}</span> : null}
    </span>
  </span>
);
