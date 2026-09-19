'use client';

import * as React from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import { Badge, Button, cn } from '@engloop/ui';
import { CheckStatusBadge, SeverityBadge, FindingStatusBadge } from '@/components/common/badges';
import { formatDuration, titleCase } from '@/lib/format';
import type { ReviewFindingSummary, TestRunSummary } from '@/lib/types';

export const TestResultCard = ({ run }: { run: TestRunSummary }): React.JSX.Element => {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <CheckStatusBadge status={run.status} />
          <span className="text-xs text-muted-foreground">
            {run.passedChecks}/{run.totalChecks} passed · {formatDuration(run.durationMs)}
          </span>
        </div>
        {run.coverage ? (
          <span className="text-[11px] text-muted-foreground">
            coverage {String(run.coverage.lines ?? '—')}% lines
          </span>
        ) : null}
      </div>

      <ul className="divide-y divide-border">
        {run.results.map((result) => {
          const open = expanded === result.id;
          const output = `${result.stdout}\n${result.stderr}`.trim();
          return (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : result.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CheckStatusBadge status={result.status} />
                  <span className="truncate font-mono text-xs">{result.command}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <span>exit {result.exitCode ?? '—'}</span>
                  <span>{formatDuration(result.durationMs)}</span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
                  />
                </span>
              </button>
              {open ? (
                <pre className="mx-3 mb-3 max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed scrollbar-thin">
                  {output || 'No output captured.'}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const ReviewFindingCard = ({
  finding,
  onUpdateStatus,
}: {
  finding: ReviewFindingSummary;
  onUpdateStatus?: (status: string) => void;
}): React.JSX.Element => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <Badge tone="outline">{titleCase(finding.uiCategory ?? finding.category)}</Badge>
        {finding.viewport ? <Badge tone="outline">{titleCase(finding.viewport)}</Badge> : null}
        <FindingStatusBadge status={finding.status} />
      </div>
      {onUpdateStatus && finding.status === 'OPEN' ? (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => onUpdateStatus('RESOLVED')}
          >
            Resolve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => onUpdateStatus('ACCEPTED_RISK')}
          >
            Accept risk
          </Button>
        </div>
      ) : null}
    </div>

    {finding.file ? (
      <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <Terminal className="h-3 w-3" />
        {finding.file}
        {finding.line ? `:${String(finding.line)}` : ''}
      </p>
    ) : null}

    <p className="mt-2 text-xs leading-relaxed">{finding.problem}</p>
    <p className="mt-1.5 rounded-md border border-info/20 bg-info/5 px-2 py-1.5 text-xs leading-relaxed text-info-strong">
      <span className="font-medium">Required fix:</span> {finding.requiredFix}
    </p>
  </div>
);

export const CodeFileItem = ({
  path,
  additions,
  deletions,
  changeType,
}: {
  path: string;
  additions?: number;
  deletions?: number;
  changeType?: string;
}): React.JSX.Element => (
  <li className="flex items-center justify-between gap-3 py-1.5">
    <span className="truncate font-mono text-xs">{path}</span>
    <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
      {changeType ? <Badge tone="outline">{changeType}</Badge> : null}
      {additions !== undefined ? <span className="text-success-strong">+{additions}</span> : null}
      {deletions !== undefined ? <span className="text-danger-strong">−{deletions}</span> : null}
    </span>
  </li>
);
