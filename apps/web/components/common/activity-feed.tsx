import type * as React from 'react';
import Link from 'next/link';
import {
  Bot,
  GitBranch,
  ScanEye,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { relativeTime } from '@/lib/format';
import type { AuditLogSummary } from '@/lib/types';

const ICONS: Record<string, LucideIcon> = {
  AGENT_STARTED: Bot,
  AGENT_STOPPED: Bot,
  COMMAND_EXECUTED: SquareTerminal,
  TASK_TRANSITIONED: Workflow,
  GIT_ACTION: GitBranch,
  APPROVAL_DECISION: ShieldCheck,
  REVIEW_DECISION: ScanEye,
  CONFIGURATION_CHANGED: Settings2,
  SCHEDULE_CHANGED: Settings2,
  SECRET_ACCESSED: ShieldCheck,
  INJECTION_DETECTED: ShieldAlert,
};

export const ActivityFeed = ({ entries }: { entries: AuditLogSummary[] }): React.JSX.Element => (
  <ol className="divide-y divide-border">
    {entries.map((entry) => {
      const Icon = ICONS[entry.action] ?? Workflow;
      const body = (
        <div className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-foreground">{entry.summary}</p>
            <p className="text-[11px] text-muted-foreground">
              {entry.actorType.toLowerCase()} · {relativeTime(entry.createdAt)}
            </p>
          </div>
        </div>
      );

      return (
        <li key={entry.id}>
          {entry.taskId ? (
            <Link href={`/engineering/tasks/${entry.taskId}`} className="block hover:bg-muted/50">
              {body}
            </Link>
          ) : (
            body
          )}
        </li>
      );
    })}
  </ol>
);
