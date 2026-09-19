import { Injectable } from '@nestjs/common';
import { ApprovalStatus, FindingStatus, RunStatus, Severity, TaskStatus } from '@engloop/types';
import { inboxItemType, type InboxItem, type ListInboxQuery } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ownedApprovalWhere,
  ownedFindingWhere,
  ownedWorkflowRunWhere,
} from '../../common/tenant-ownership';

/** Severities that make a finding worth a person's attention. */
const BLOCKING: Severity[] = [Severity.CRITICAL, Severity.HIGH];

/**
 * The action inbox (feature F1, read-only slice).
 *
 * Every item is **computed from the record that already owns the state** — there
 * is no inbox table. That is what makes "resolving the source removes the item"
 * structural rather than a reconciliation job: there is no second copy to drift.
 *
 * Four of full F1's six sources are aggregated here. Mentions need P5 to validate
 * organization membership, and budget alerts need a product decision about what
 * spend is alertable; both are deliberately absent rather than approximated.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListInboxQuery): Promise<{ items: InboxItem[] }> {
    const { projectId } = query;

    // Read the four sources in parallel. Each is scoped by the shared
    // fail-closed ownership builders rather than a filter written here.
    const [approvals, humanReviewTasks, failedRuns, findings] = await this.prisma.$transaction([
      this.prisma.approval.findMany({
        where: {
          ...ownedApprovalWhere(organizationId, projectId),
          status: ApprovalStatus.PENDING,
        },
        include: { project: { select: { id: true, name: true } }, task: { select: { key: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.findMany({
        where: {
          status: TaskStatus.NEEDS_HUMAN_REVIEW,
          project: { organizationId, ...(projectId ? { id: projectId } : {}) },
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.workflowRun.findMany({
        where: { ...ownedWorkflowRunWhere(organizationId, projectId), status: RunStatus.FAILED },
        include: {
          project: { select: { id: true, name: true } },
          task: { select: { key: true, title: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.reviewFinding.findMany({
        where: {
          ...ownedFindingWhere(organizationId, undefined, projectId),
          severity: { in: BLOCKING },
          status: { in: [FindingStatus.OPEN, FindingStatus.FIXING] },
        },
        include: {
          reviewRun: {
            select: {
              taskId: true,
              task: {
                select: { key: true, projectId: true, project: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const items: InboxItem[] = [
      ...approvals.map((approval) => ({
        type: inboxItemType.APPROVAL,
        sourceId: approval.id,
        projectId: approval.project.id,
        projectName: approval.project.name,
        // An approval blocks the loop until a person answers it.
        severity: Severity.HIGH,
        title: `${approval.kind} approval requested`,
        detail: approval.reason,
        taskKey: approval.task?.key ?? null,
        firstSeenAt: approval.createdAt.toISOString(),
        deepLink: approval.taskId
          ? `/engineering/tasks/${approval.taskId}`
          : `/settings/approvals`,
      })),
      ...humanReviewTasks.map((task) => ({
        type: inboxItemType.HUMAN_REVIEW,
        sourceId: task.id,
        projectId: task.project.id,
        projectName: task.project.name,
        severity: Severity.HIGH,
        title: task.title,
        detail: 'Definition of done was not satisfied; a human decision is required.',
        taskKey: task.key,
        // updatedAt, not createdAt: the task became inbox-worthy when it entered
        // this status, not when it was first created.
        firstSeenAt: task.updatedAt.toISOString(),
        deepLink: `/engineering/tasks/${task.id}`,
      })),
      ...failedRuns.map((run) => ({
        type: inboxItemType.WORKFLOW_FAILURE,
        sourceId: run.id,
        projectId: run.project.id,
        projectName: run.project.name,
        severity: Severity.MEDIUM,
        title: run.task?.title ?? 'Workflow run failed',
        detail: run.error,
        taskKey: run.task?.key ?? null,
        firstSeenAt: run.updatedAt.toISOString(),
        deepLink: `/engineering/runs/${run.id}`,
      })),
      ...findings.flatMap((finding) => {
        const project = finding.reviewRun.task?.project;
        // ownedFindingWhere permits a finding whose review run has no task, but
        // such a row has no project to attribute it to, so it cannot be shown.
        if (!project) return [];
        return [
          {
            type: inboxItemType.BLOCKING_FINDING,
            sourceId: finding.id,
            projectId: project.id,
            projectName: project.name,
            severity: finding.severity,
            title: finding.problem,
            detail: finding.requiredFix,
            taskKey: finding.reviewRun.task?.key ?? null,
            firstSeenAt: finding.createdAt.toISOString(),
            deepLink: finding.reviewRun.taskId
              ? `/engineering/tasks/${finding.reviewRun.taskId}`
              : `/quality/bugs`,
          },
        ];
      }),
    ];

    const filtered = items.filter(
      (item) =>
        (!query.type || item.type === query.type) &&
        (!query.severity || item.severity === query.severity),
    );

    // Newest first. A task that is NEEDS_HUMAN_REVIEW *and* has a pending
    // approval legitimately produces two items: they are two distinct decisions.
    filtered.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));

    return { items: filtered };
  }
}
