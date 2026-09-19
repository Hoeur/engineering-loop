'use client';

import * as React from 'react';
import Link from 'next/link';
import { ScanEye } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { ReviewFindingCard } from '@/components/run/check-cards';
import { relativeTime, titleCase } from '@/lib/format';
import { useProjects, useReviewRuns, useUpdateFinding } from '@/lib/queries';

export default function ReviewsPage(): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [decision, setDecision] = React.useState<string | undefined>();
  const projects = useProjects();
  const reviews = useReviewRuns({ projectId, decision });
  const updateFinding = useUpdateFinding();

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Structured review runs. A review can only approve when zero critical or high findings remain open."
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
            id: 'decision',
            label: 'Decision',
            value: decision,
            onChange: setDecision,
            options: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'FAILED'].map((value) => ({
              label: titleCase(value),
              value,
            })),
          },
        ]}
        onReset={() => {
          setProjectId(undefined);
          setDecision(undefined);
        }}
      />

      <QueryBoundary
        query={reviews}
        entity="Reviews"
        loadingLabel="Loading reviews…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={ScanEye}
            title="No reviews yet"
            description="Reviews appear once an implementation has been verified by the deterministic checks."
          />
        }
      >
        {(data) => (
          <div className="space-y-3">
            {data.items.map((review) => (
              <Card key={review.id}>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      {review.task ? `${review.task.key} · ${review.task.title}` : 'Review run'}
                    </CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {titleCase(review.kind)} · cycle {review.cycle} ·{' '}
                      {relativeTime(review.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="outline">score {review.score}</Badge>
                    <Badge tone={review.decision === 'APPROVED' ? 'success' : 'warning'}>
                      {titleCase(review.decision)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">{review.summary}</p>
                  {review.findings.length > 0 ? (
                    <div className="space-y-2">
                      {review.findings.map((finding) => (
                        <ReviewFindingCard
                          key={finding.id}
                          finding={finding}
                          onUpdateStatus={(status) =>
                            updateFinding.mutate({ id: finding.id, status })
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                  {review.task ? (
                    <Link
                      href={`/engineering/tasks/${review.task.id}`}
                      className="inline-block text-xs text-info-strong hover:underline"
                    >
                      Open task →
                    </Link>
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
