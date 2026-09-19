'use client';

import * as React from 'react';
import Link from 'next/link';
import { Inbox as InboxIcon } from 'lucide-react';
import { Severity } from '@engloop/types';
import { Card, CardContent } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { SeverityBadge } from '@/components/common/badges';
import { relativeTime, titleCase } from '@/lib/format';
import { useInbox, useProjects } from '@/lib/queries';
import type { InboxItem } from '@/lib/types';

const ITEM_TYPES = [
  'APPROVAL',
  'HUMAN_REVIEW',
  'WORKFLOW_FAILURE',
  'BLOCKING_FINDING',
] as const;

const TYPE_LABELS: Record<InboxItem['type'], string> = {
  APPROVAL: 'Approval',
  HUMAN_REVIEW: 'Human review',
  WORKFLOW_FAILURE: 'Workflow failure',
  BLOCKING_FINDING: 'Blocking finding',
};

/**
 * The action inbox (feature F1, read-only slice).
 *
 * Items are computed by the API from the records that already hold the state —
 * approvals, human-review tasks, failed runs and blocking findings — so
 * resolving the source record removes the item with no reconciliation step.
 *
 * Polled, not streamed: the live-event work (P3) has not landed. Claim,
 * reassign, snooze and mentions need authenticated identity (P5) and are
 * deliberately absent rather than half-built.
 */
export default function InboxPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [type, setType] = React.useState<string | undefined>();
  const [severity, setSeverity] = React.useState<string | undefined>();

  const projects = useProjects();
  const inbox = useInbox({ projectId, type, severity });

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Every decision waiting on a person, across approvals, reviews, runs and findings."
      />

      <FilterBar
        filters={[
          {
            id: 'project',
            label: 'Project',
            value: projectId,
            onChange: setProjectId,
            options: (projects.data?.items ?? []).map((project) => ({
              label: project.name,
              value: project.id,
            })),
          },
          {
            id: 'type',
            label: 'Type',
            value: type,
            onChange: setType,
            options: ITEM_TYPES.map((value) => ({ label: TYPE_LABELS[value], value })),
          },
          {
            id: 'severity',
            label: 'Severity',
            value: severity,
            onChange: setSeverity,
            options: Object.values(Severity).map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setType(undefined);
          setSeverity(undefined);
        }}
      />

      <QueryBoundary
        query={inbox}
        entity="inbox"
        loadingLabel="Loading your inbox…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={InboxIcon}
            title="Nothing needs you right now"
            description="Approvals, human-review tasks, failed workflows and blocking findings appear here."
          />
        }
      >
        {(data) => (
          <ul className="space-y-3">
            {data.items.map((item) => (
              <li key={`${item.type}:${item.sourceId}`}>
                <Card>
                  <CardContent className="p-4">
                    <Link
                      href={item.deepLink}
                      className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <SeverityBadge severity={item.severity} />
                        <span className="font-medium text-foreground">
                          {TYPE_LABELS[item.type]}
                        </span>
                        {item.taskKey ? (
                          <span className="font-mono">{item.taskKey}</span>
                        ) : null}
                        <span aria-hidden="true">·</span>
                        <span>{item.projectName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{relativeTime(item.firstSeenAt)}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium">{item.title}</p>
                      {item.detail ? (
                        <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                      ) : null}
                    </Link>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
