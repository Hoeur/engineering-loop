'use client';

import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Severity } from '@engloop/types';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { ReviewFindingCard } from '@/components/run/check-cards';
import { titleCase } from '@/lib/format';
import { useFindings, useProjects, useUpdateFinding } from '@/lib/queries';

export interface FindingsScreenProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Restrict to these review categories; omit for all. */
  categories?: string[];
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * Shared implementation for the Quality section. Bugs, Security, Performance and
 * UI QA are the same screen with a different category filter, so they cannot
 * drift apart.
 */
export const FindingsScreen = ({
  title,
  description,
  icon,
  categories,
  emptyTitle,
  emptyDescription,
}: FindingsScreenProps): React.JSX.Element => {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [severity, setSeverity] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>('OPEN');

  const projects = useProjects();
  const findings = useFindings({ projectId, severity, status });
  const updateFinding = useUpdateFinding();

  return (
    <>
      <PageHeader title={title} description={description} />

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
            id: 'severity',
            label: 'Severity',
            value: severity,
            onChange: setSeverity,
            options: Object.values(Severity).map((value) => ({ label: titleCase(value), value })),
          },
          {
            id: 'status',
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: ['OPEN', 'FIXING', 'RESOLVED', 'WONT_FIX', 'ACCEPTED_RISK'].map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setSeverity(undefined);
          setStatus(undefined);
        }}
      />

      <QueryBoundary
        query={findings}
        entity="Findings"
        loadingLabel="Loading findings…"
        emptyCheck={(data) =>
          data.items.filter((finding) => !categories || categories.includes(finding.category))
            .length === 0
        }
        empty={<EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />}
      >
        {(data) => (
          <div className="space-y-2">
            {data.items
              .filter((finding) => !categories || categories.includes(finding.category))
              .map((finding) => (
                <div key={finding.id} className="space-y-1">
                  {finding.reviewRun?.task ? (
                    <Link
                      href={`/engineering/tasks/${finding.reviewRun.task.id}`}
                      className="inline-block font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {finding.reviewRun.task.key} · {finding.reviewRun.task.title}
                    </Link>
                  ) : null}
                  <ReviewFindingCard
                    finding={finding}
                    onUpdateStatus={(next) =>
                      updateFinding.mutate({ id: finding.id, status: next })
                    }
                  />
                </div>
              ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
};
