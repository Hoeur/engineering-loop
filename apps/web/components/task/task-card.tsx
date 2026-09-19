'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Boxes, GitBranch, RefreshCcw } from 'lucide-react';
import { cn } from '@engloop/ui';
import { AgentBadge, CostBadge, PriorityBadge, StatusBadge } from '@/components/common/badges';
import { relativeTime } from '@/lib/format';
import type { TaskSummary } from '@/lib/types';

/** Board card (spec section 26): key, title, priority, agent, repo, cost, attempts. */
export const TaskCard = ({
  task,
  className,
}: {
  task: TaskSummary;
  className?: string;
}): React.JSX.Element => (
  <Link
    href={`/engineering/tasks/${task.id}`}
    className={cn(
      'block rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:border-foreground/20',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
  >
    <div className="flex items-start justify-between gap-2">
      <span className="font-mono text-[11px] text-muted-foreground">{task.key}</span>
      <PriorityBadge priority={task.priority} />
    </div>

    <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug">{task.title}</p>

    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      {task.repository ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Boxes className="h-3 w-3 shrink-0" />
          <span className="truncate">{task.repository.name}</span>
        </span>
      ) : null}
      {task.branchName ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{task.branchName.split('/').pop()}</span>
        </span>
      ) : null}
      {task.attemptCount > 0 ? (
        <span className="inline-flex items-center gap-1">
          <RefreshCcw className="h-3 w-3" />
          {task.attemptCount}/{task.maxAttempts}
        </span>
      ) : null}
    </div>

    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
      <div className="min-w-0 flex-1">
        {task.assignedAgent ? (
          <AgentBadge name={task.assignedAgent.name} role={task.assignedAgent.role} />
        ) : (
          <span className="text-[11px] text-muted-foreground">Unassigned</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <CostBadge value={task.actualCost} />
        <StatusBadge status={task.status} />
      </div>
    </div>

    <p className="mt-1.5 text-[10px] text-muted-foreground">
      Updated {relativeTime(task.lastActivityAt)}
    </p>
  </Link>
);
