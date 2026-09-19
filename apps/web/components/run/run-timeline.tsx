'use client';

import type * as React from 'react';
import {
  Check,
  ChevronsRight,
  CircleDashed,
  Loader2,
  MinusCircle,
  UserCheck,
  X,
} from 'lucide-react';
import { RunStatus, type WorkflowStepKey } from '@engloop/types';
import { Badge, cn } from '@engloop/ui';
import { formatCost, formatDuration, formatTokens, titleCase } from '@/lib/format';
import type { WorkflowRunDetail, WorkflowStepSummary } from '@/lib/types';

const STATE_ICON: Record<RunStatus, React.ElementType> = {
  PENDING: CircleDashed,
  RUNNING: Loader2,
  SUCCEEDED: Check,
  FAILED: X,
  CANCELLED: MinusCircle,
  SKIPPED: MinusCircle,
  WAITING_FOR_HUMAN: UserCheck,
};

const STATE_CLASS: Record<RunStatus, string> = {
  PENDING: 'border-border bg-background text-muted-foreground',
  RUNNING: 'border-info/40 bg-info/10 text-info-strong',
  SUCCEEDED: 'border-success/40 bg-success/10 text-success-strong',
  FAILED: 'border-danger/40 bg-danger/10 text-danger-strong',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
  SKIPPED: 'border-border bg-muted text-muted-foreground',
  WAITING_FOR_HUMAN: 'border-warning/40 bg-warning/10 text-warning-strong',
};

/** Who performs a step — the "Codex / Claude Code / CI / GitHub" column. */
const executorLabel = (
  kind: string,
  role: string | null,
  step: WorkflowStepSummary | undefined,
): string => {
  const providerKey = step?.agentRuns?.[0]?.providerKey;
  if (providerKey) return providerKey;
  if (kind === 'SYSTEM') return 'CI';
  if (kind === 'GIT') return 'Git';
  if (kind === 'HUMAN') return 'Human';
  return role ? titleCase(role) : 'System';
};

export const RunStep = ({
  title,
  description,
  executor,
  status,
  step,
}: {
  title: string;
  description: string;
  executor: string;
  status: RunStatus;
  step?: WorkflowStepSummary;
}): React.JSX.Element => {
  const Icon = STATE_ICON[status];
  const agentRun = step?.agentRuns?.[0];
  const testRun = step?.testRuns?.[0];
  const reviewRun = step?.reviewRuns?.[0];

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        className={cn(
          'z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          STATE_CLASS[status],
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', status === RunStatus.RUNNING && 'animate-spin')} />
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {executor}
          </span>
          <span className="text-sm font-medium">{title}</span>
          {step?.attempt && step.attempt > 1 ? (
            <Badge tone="warning">attempt {step.attempt}</Badge>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">{description}</p>

        {step ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
            {step.durationMs ? <span>{formatDuration(step.durationMs)}</span> : null}
            {agentRun ? (
              <>
                <span>{formatTokens(agentRun.totalTokens)} tokens</span>
                <span>{formatCost(agentRun.estimatedCost)}</span>
              </>
            ) : null}
            {testRun ? (
              <span className={testRun.passed ? 'text-success-strong' : 'text-danger-strong'}>
                {testRun.passedChecks}/{testRun.totalChecks} checks passed
              </span>
            ) : null}
            {reviewRun ? (
              <span
                className={
                  reviewRun.decision === 'APPROVED' ? 'text-success-strong' : 'text-warning-strong'
                }
              >
                {titleCase(reviewRun.decision)} · {reviewRun.findings.length} findings
              </span>
            ) : null}
          </div>
        ) : null}

        {step?.error ? (
          <p className="rounded-md border border-danger/25 bg-danger/5 px-2 py-1 font-mono text-[11px] text-danger-strong">
            {step.error}
          </p>
        ) : null}
      </div>
    </li>
  );
};

/**
 * Renders every step the definition declares — not only the ones that ran — so
 * the timeline shows what is still ahead (spec section 28).
 */
export const RunTimeline = ({ run }: { run: WorkflowRunDetail }): React.JSX.Element => {
  const stepsByKey = new Map<WorkflowStepKey, WorkflowStepSummary>();
  for (const step of run.steps) {
    const existing = stepsByKey.get(step.stepKey);
    if (!existing || step.sequence > existing.sequence) stepsByKey.set(step.stepKey, step);
  }

  return (
    <ol className="relative">
      <span className="absolute left-3 top-2 h-[calc(100%-1rem)] w-px bg-border" aria-hidden />
      {run.definition.steps.map((definition) => {
        const step = stepsByKey.get(definition.key);
        const status =
          step?.status ??
          (run.currentStepKey === definition.key ? RunStatus.RUNNING : RunStatus.PENDING);
        return (
          <RunStep
            key={definition.key}
            title={definition.title}
            description={definition.description}
            executor={executorLabel(definition.kind, definition.role, step)}
            status={status}
            step={step}
          />
        );
      })}
    </ol>
  );
};

export const StepIndicator = ({ status }: { status: RunStatus }): React.JSX.Element => {
  const Icon = STATE_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-full border',
        STATE_CLASS[status],
      )}
    >
      <Icon className={cn('h-3 w-3', status === RunStatus.RUNNING && 'animate-spin')} />
    </span>
  );
};

export const ProgressSummary = ({ run }: { run: WorkflowRunDetail }): React.JSX.Element => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <ChevronsRight className="h-3.5 w-3.5" />
    <span>
      {run.progress.completed}/{run.progress.total} steps
    </span>
    <span aria-hidden>·</span>
    <span>
      review cycle {run.reviewCycle}/{run.project ? '' : ''}
      {run.definition.steps.length > 0 ? '' : ''}
    </span>
  </div>
);
