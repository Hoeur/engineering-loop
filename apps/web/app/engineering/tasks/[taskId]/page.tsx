'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CircleAlert,
  FileDiff,
  GitBranch,
  GitPullRequest,
  History,
  Monitor,
  Package,
} from 'lucide-react';
import { type RunStatus } from '@engloop/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { QueryBoundary, EmptyState } from '@/components/common/states';
import { ActivityFeed } from '@/components/common/activity-feed';
import {
  AgentBadge,
  AgentRunStatusBadge,
  CostBadge,
  PriorityBadge,
  RiskBadge,
  RunStatusBadge,
  StatusBadge,
} from '@/components/common/badges';
import { TaskActions } from '@/components/task/task-actions';
import { ReviewFindingCard, TestResultCard } from '@/components/run/check-cards';
import { StepIndicator } from '@/components/run/run-timeline';
import {
  absoluteTime,
  formatCost,
  formatDuration,
  formatTokens,
  relativeTime,
  titleCase,
} from '@/lib/format';
import { useAddComment, useAuditLogs, useTask, useUpdateFinding } from '@/lib/queries';

// `min-w-0` on the cell and the value: a grid item defaults to a minimum size of
// its content, so a long branch name or absolute worktree path would widen the
// card and spill past its border instead of truncating.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 space-y-0.5">
    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-xs">{children}</dd>
  </div>
);

export default function TaskDetailPage(): React.JSX.Element {
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;
  const task = useTask(taskId);
  const audit = useAuditLogs({ taskId, pageSize: 50 });
  const updateFinding = useUpdateFinding();
  const addComment = useAddComment(taskId);
  const [comment, setComment] = React.useState('');

  return (
    <QueryBoundary query={task} entity="Task" loadingLabel="Loading task…">
      {(data) => {
        const latestRun = data.workflowRuns[0];
        const latestTestRun = data.testRuns[0];
        const openFindings = data.reviewRuns
          .flatMap((review) => review.findings)
          .filter((finding) => finding.status === 'OPEN' || finding.status === 'FIXING');
        const diffArtifact = data.artifacts.find((artifact) => artifact.kind === 'DIFF');
        const uiFindings = data.reviewRuns
          .filter((review) => review.kind === 'UI')
          .flatMap((review) => review.findings);

        return (
          <>
            <PageHeader
              breadcrumbs={
                <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Link href="/engineering/tasks" className="hover:text-foreground">
                    Tasks
                  </Link>
                  <span>/</span>
                  <span className="font-mono">{data.key}</span>
                </nav>
              }
              title={data.title}
              description={data.objective || undefined}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={data.status} />
                  <PriorityBadge priority={data.priority} />
                  <RiskBadge risk={data.riskLevel} />
                </div>
              }
            />

            {data.blockedReason ? (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning-strong">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{data.blockedReason}</p>
              </div>
            ) : null}

            <div className="mb-5">
              <TaskActions task={data} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Requirement</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {data.description || 'No description was provided.'}
                    </p>

                    <div>
                      <h3 className="mb-1.5 text-xs font-semibold">Acceptance criteria</h3>
                      {data.acceptanceCriteria.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          None recorded yet — run the planner to generate them.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {data.acceptanceCriteria.map((criterion, index) => (
                            <li key={index} className="flex gap-2 text-xs">
                              <span className="text-muted-foreground">{index + 1}.</span>
                              <span>{criterion}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {data.implementationNotes.length > 0 ? (
                      <div>
                        <h3 className="mb-1.5 text-xs font-semibold">Implementation notes</h3>
                        <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                          {data.implementationNotes.map((note, index) => (
                            <li key={index}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Tabs defaultValue="activity">
                  <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="activity">Agent activity</TabsTrigger>
                    <TabsTrigger value="plan">Plan</TabsTrigger>
                    <TabsTrigger value="tests">Tests</TabsTrigger>
                    <TabsTrigger value="review">Review</TabsTrigger>
                    <TabsTrigger value="changes">Changes</TabsTrigger>
                    <TabsTrigger value="ui-qa">UI QA</TabsTrigger>
                    <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                  </TabsList>

                  <TabsContent value="activity" className="space-y-3">
                    {data.agentRuns.length === 0 ? (
                      <EmptyState
                        title="No agent has run yet"
                        description="Start the engineering loop to see planner, implementer and reviewer runs here."
                      />
                    ) : (
                      <div className="rounded-lg border border-border bg-card">
                        <ul className="divide-y divide-border">
                          {data.agentRuns.map((run) => (
                            <li
                              key={run.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <AgentBadge
                                  name={run.agent?.name ?? run.providerKey}
                                  role={run.role}
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{formatTokens(run.totalTokens)} tokens</span>
                                <CostBadge value={run.estimatedCost} />
                                <span>{formatDuration(run.durationMs)}</span>
                                <span>{relativeTime(run.createdAt)}</span>
                                <AgentRunStatusBadge status={run.status} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="plan">
                    {data.plan ? (
                      <Card>
                        <CardContent className="space-y-3 pt-5">
                          <div>
                            <h3 className="text-xs font-semibold">Summary</h3>
                            <p className="text-xs text-muted-foreground">{data.plan.summary}</p>
                          </div>
                          <div>
                            <h3 className="text-xs font-semibold">Approach</h3>
                            <p className="text-xs text-muted-foreground">{data.plan.approach}</p>
                          </div>
                          {data.plan.risks.length > 0 ? (
                            <div>
                              <h3 className="text-xs font-semibold">Risks</h3>
                              <ul className="list-inside list-disc text-xs text-muted-foreground">
                                {data.plan.risks.map((risk, index) => (
                                  <li key={index}>{risk}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {data.plan.tasks.length > 0 ? (
                            <div>
                              <h3 className="mb-1.5 text-xs font-semibold">Generated tasks</h3>
                              <ul className="space-y-1">
                                {data.plan.tasks.map((planned, index) => (
                                  <li key={index} className="flex items-center gap-2 text-xs">
                                    <PriorityBadge priority={planned.priority} />
                                    <span className="truncate">{planned.title}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ) : (
                      <EmptyState
                        title="No plan yet"
                        description={
                          data.planSummary ??
                          'Run the planner to produce an approach, risks and structured child tasks.'
                        }
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="tests" className="space-y-3">
                    {data.testRuns.length === 0 ? (
                      <EmptyState
                        title="No checks have run"
                        description="EngLoop runs lint, typecheck, tests and build itself — an agent cannot mark them passed."
                      />
                    ) : (
                      data.testRuns.map((run) => <TestResultCard key={run.id} run={run} />)
                    )}
                  </TabsContent>

                  <TabsContent value="review" className="space-y-3">
                    {data.reviewRuns.length === 0 ? (
                      <EmptyState
                        title="No review yet"
                        description="Queue a review once an implementation exists."
                      />
                    ) : (
                      data.reviewRuns.map((review) => (
                        <Card key={review.id}>
                          <CardHeader className="flex-row items-center justify-between space-y-0">
                            <CardTitle>
                              {titleCase(review.kind)} review · cycle {review.cycle}
                            </CardTitle>
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
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="changes" className="space-y-3">
                    {data.commits.length === 0 && !diffArtifact ? (
                      <EmptyState
                        title="No changes recorded"
                        description="Commits and the captured diff appear here once the implementer runs."
                      />
                    ) : (
                      <>
                        {data.commits.length > 0 ? (
                          <Card>
                            <CardHeader>
                              <CardTitle>Commits</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ul className="divide-y divide-border">
                                {data.commits.map((commit) => (
                                  <li
                                    key={commit.id}
                                    className="flex items-center justify-between gap-3 py-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-xs">{commit.message}</p>
                                      <p className="font-mono text-[10px] text-muted-foreground">
                                        {commit.sha.slice(0, 10)} · {commit.filesChanged} files
                                      </p>
                                    </div>
                                    <span className="shrink-0 text-[11px] tabular-nums">
                                      <span className="text-success-strong">
                                        +{commit.additions}
                                      </span>{' '}
                                      <span className="text-danger-strong">
                                        −{commit.deletions}
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </CardContent>
                          </Card>
                        ) : null}

                        {diffArtifact ? (
                          <Card>
                            <CardHeader className="flex-row items-center justify-between space-y-0">
                              <CardTitle className="flex items-center gap-1.5">
                                <FileDiff className="h-3.5 w-3.5" /> Git diff
                              </CardTitle>
                              <span className="text-[11px] text-muted-foreground">
                                {diffArtifact.sizeBytes} bytes
                              </span>
                            </CardHeader>
                            <CardContent>
                              <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed scrollbar-thin">
                                {diffArtifact.content ?? 'Diff content is stored as an artifact.'}
                              </pre>
                            </CardContent>
                          </Card>
                        ) : null}
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="ui-qa" className="space-y-3">
                    {uiFindings.length === 0 ? (
                      <EmptyState
                        icon={Monitor}
                        title="No UI review recorded"
                        description="UI QA captures desktop (1440×900), tablet (768×1024) and mobile (375×812) screenshots, console errors and failed requests. Screenshot capture is mocked in this MVP."
                      />
                    ) : (
                      uiFindings.map((finding) => (
                        <ReviewFindingCard key={finding.id} finding={finding} />
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="artifacts">
                    {data.artifacts.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="No artifacts"
                        description="Diffs, logs and reports appear here."
                      />
                    ) : (
                      <div className="rounded-lg border border-border bg-card">
                        <ul className="divide-y divide-border">
                          {data.artifacts.map((artifact) => (
                            <li
                              key={artifact.id}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-mono text-xs">{artifact.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {artifact.kind} · {artifact.contentType}
                                </p>
                              </div>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {relativeTime(artifact.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="audit">
                    <QueryBoundary query={audit} loadingLabel="Loading audit history…">
                      {(log) =>
                        log.items.length === 0 ? (
                          <EmptyState icon={History} title="No audit entries" />
                        ) : (
                          <Card>
                            <CardContent className="pt-4">
                              <ActivityFeed entries={log.items} />
                            </CardContent>
                          </Card>
                        )
                      }
                    </QueryBoundary>
                  </TabsContent>
                </Tabs>

                <Card>
                  <CardHeader>
                    <CardTitle>Comments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.comments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No comments yet.</p>
                    ) : (
                      <ul className="space-y-3">
                        {data.comments.map((entry) => (
                          <li key={entry.id} className="space-y-1">
                            <p className="text-[11px] font-medium">
                              {entry.author?.name ?? 'System'}{' '}
                              <span className="font-normal text-muted-foreground">
                                · {relativeTime(entry.createdAt)}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">{entry.body}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Separator />
                    <form
                      className="flex flex-col gap-2 sm:flex-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!comment.trim()) return;
                        addComment.mutate(comment.trim(), { onSuccess: () => setComment('') });
                      }}
                    >
                      <input
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="Add a comment…"
                        aria-label="Add a comment"
                        className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!comment.trim() || addComment.isPending}
                      >
                        Comment
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-3">
                      <Field label="Project">{data.project?.name ?? '—'}</Field>
                      <Field label="Repository">{data.repository?.name ?? '—'}</Field>
                      <Field label="Type">{titleCase(data.type)}</Field>
                      <Field label="Attempts">
                        {data.attemptCount}/{data.maxAttempts}
                      </Field>
                      <Field label="Review cycles">{data.reviewCycle}</Field>
                      <Field label="Actual cost">{formatCost(data.actualCost)}</Field>
                      <Field label="Created">{absoluteTime(data.createdAt)}</Field>
                      <Field label="Last activity">{relativeTime(data.lastActivityAt)}</Field>
                      <Field label="Branch">
                        {data.branchName ? (
                          <span className="flex min-w-0 items-center gap-1 font-mono text-[11px]">
                            <GitBranch className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 truncate" title={data.branchName}>
                              {data.branchName}
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </Field>
                      <Field label="Worktree">
                        <span
                          className="block truncate font-mono text-[11px]"
                          title={data.worktreePath ?? undefined}
                        >
                          {data.worktreePath ?? '—'}
                        </span>
                      </Field>
                    </dl>
                  </CardContent>
                </Card>

                {latestRun ? (
                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <CardTitle>Latest workflow run</CardTitle>
                      <RunStatusBadge status={latestRun.status} />
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <ul className="space-y-1.5">
                        {latestRun.steps.slice(-6).map((step) => (
                          <li key={step.id} className="flex items-center gap-2 text-xs">
                            <StepIndicator status={step.status as RunStatus} />
                            <span className="truncate">{titleCase(step.stepKey)}</span>
                          </li>
                        ))}
                      </ul>
                      <Button asChild size="sm" variant="outline" className="w-full">
                        <Link href={`/engineering/runs/${latestRun.id}`}>Open live run</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                {openFindings.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Open findings ({openFindings.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {openFindings.slice(0, 4).map((finding) => (
                        <div key={finding.id} className="text-xs">
                          <Badge
                            tone={
                              finding.severity === 'CRITICAL' || finding.severity === 'HIGH'
                                ? 'danger'
                                : 'warning'
                            }
                          >
                            {titleCase(finding.severity)}
                          </Badge>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">
                            {finding.problem}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {data.dependencies.length > 0 || data.dependents.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Dependencies</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      {data.dependencies.map((dependency) => (
                        <Link
                          key={dependency.id}
                          href={`/engineering/tasks/${dependency.dependsOn.id}`}
                          className="flex items-center justify-between gap-2 hover:text-foreground"
                        >
                          <span className="truncate">
                            <span className="font-mono text-muted-foreground">
                              {dependency.dependsOn.key}
                            </span>{' '}
                            {dependency.dependsOn.title}
                          </span>
                          <StatusBadge status={dependency.dependsOn.status} />
                        </Link>
                      ))}
                      {data.dependents.map((dependent) => (
                        <Link
                          key={dependent.id}
                          href={`/engineering/tasks/${dependent.task.id}`}
                          className="flex items-center justify-between gap-2 text-muted-foreground hover:text-foreground"
                        >
                          <span className="truncate">blocks {dependent.task.key}</span>
                          <StatusBadge status={dependent.task.status} />
                        </Link>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {data.pullRequests.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Pull requests</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      {data.pullRequests.map((pullRequest) => (
                        <div
                          key={pullRequest.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{pullRequest.title}</span>
                          </span>
                          <Badge tone={pullRequest.status === 'MERGED' ? 'success' : 'info'}>
                            {titleCase(pullRequest.status)}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {latestTestRun ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Latest checks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">
                        {latestTestRun.passedChecks}/{latestTestRun.totalChecks} passed ·{' '}
                        {formatDuration(latestTestRun.durationMs)}
                      </p>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
