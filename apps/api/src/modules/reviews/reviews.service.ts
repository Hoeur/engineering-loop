import { Injectable } from '@nestjs/common';
import { FindingStatus, RunStatus, type ReviewKind } from '@engloop/types';
import { JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import { idempotencyKey } from '@engloop/workflow';
import { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/pagination';
import {
  ownedFindingWhere,
  ownedFindingSql,
  ownedReviewRunWhere,
  ownedScreenshotWhere,
} from '../../common/tenant-ownership';

/** Review orchestration and the structured-findings store (spec section 14). */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async trigger(organizationId: string, taskId: string, kind: ReviewKind) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true, reviewCycle: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const reviewRun = await this.prisma.reviewRun.create({
      data: {
        taskId,
        kind,
        status: RunStatus.PENDING,
        cycle: task.reviewCycle + 1,
      },
    });

    await this.queues.enqueue(
      QUEUE_NAMES.REVIEW,
      JOB_NAMES.RUN_REVIEW,
      { reviewRunId: reviewRun.id, taskId, kind },
      { jobId: idempotencyKey('review', reviewRun.id) },
    );

    return reviewRun;
  }

  async listForTask(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true, projectId: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const items = await this.prisma.reviewRun.findMany({
      where: { taskId, ...ownedReviewRunWhere(organizationId, task.projectId) },
      orderBy: { createdAt: 'desc' },
      include: {
        findings: {
          where: ownedFindingWhere(organizationId, taskId, task.projectId),
          orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
        },
        agentRun: { select: { id: true, providerKey: true, model: true, role: true } },
      },
    });
    return { items, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const owned = await this.prisma.reviewRun.findFirst({
      where: { id, ...ownedReviewRunWhere(organizationId) },
      select: { id: true, taskId: true, task: { select: { projectId: true } } },
    });
    if (!owned) throw AppError.notFound('ReviewRun', id);

    const run = await this.prisma.reviewRun.findFirst({
      where: { id, ...ownedReviewRunWhere(organizationId, owned.task.projectId) },
      include: {
        findings: {
          where: ownedFindingWhere(organizationId, owned.taskId, owned.task.projectId),
        },
        screenshots: {
          where: ownedScreenshotWhere(organizationId, owned.taskId, owned.task.projectId),
        },
        task: { select: { id: true, key: true, title: true } },
      },
    });
    if (!run) throw AppError.notFound('ReviewRun', id);
    return run;
  }

  async list(
    organizationId: string,
    page: number,
    pageSize: number,
    filters: { projectId?: string; decision?: string },
  ) {
    const where: Prisma.ReviewRunWhereInput = {
      ...ownedReviewRunWhere(organizationId, filters.projectId),
      ...(filters.decision
        ? { decision: filters.decision as Prisma.EnumReviewDecisionFilter['equals'] }
        : {}),
    };
    const [runs, total] = await this.prisma.$transaction([
      this.prisma.reviewRun.findMany({
        where,
        ...skipTake(page, pageSize),
        orderBy: { createdAt: 'desc' },
        include: {
          task: { select: { id: true, key: true, title: true, projectId: true } },
        },
      }),
      this.prisma.reviewRun.count({ where }),
    ]);
    const findings = runs.length
      ? await this.prisma.reviewFinding.findMany({
          where: {
            OR: runs.map((run) => ({
              reviewRunId: run.id,
              ...ownedFindingWhere(organizationId, run.taskId, run.task.projectId),
            })),
          },
        })
      : [];
    const items = runs.map((run) => ({
      ...run,
      findings: findings.filter((finding) => finding.reviewRunId === run.id),
    }));
    return paginate(items, total, page, pageSize);
  }

  async listFindings(
    organizationId: string,
    page: number,
    pageSize: number,
    filters: { projectId?: string; status?: string; severity?: string },
  ) {
    const scope = ownedFindingSql(organizationId, filters.projectId);
    const filtered = Prisma.sql`
      ${scope}
      ${filters.status ? Prisma.sql`AND f.status::text = ${filters.status}` : Prisma.empty}
      ${filters.severity ? Prisma.sql`AND f.severity::text = ${filters.severity}` : Prisma.empty}
    `;
    const { countRows, ids, rows } = await this.prisma.$transaction(async (tx) => {
      const scopedCount = await tx.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total ${filtered}
      `;
      const idRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT f.id ${filtered}
        ORDER BY f.severity ASC, f."createdAt" DESC, f.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        FOR SHARE OF f, r
      `;
      const scopedIds = idRows.map((row) => row.id);
      const scopedRows = scopedIds.length
        ? await tx.reviewFinding.findMany({
            where: {
              id: { in: scopedIds },
              ...ownedFindingWhere(organizationId, undefined, filters.projectId),
            },
            include: {
              reviewRun: {
                select: {
                  id: true,
                  kind: true,
                  cycle: true,
                  task: { select: { id: true, key: true, title: true, projectId: true } },
                },
              },
            },
          })
        : [];
      return { countRows: scopedCount, ids: scopedIds, rows: scopedRows };
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = rowById.get(id);
      return row ? [row] : [];
    });
    const total = Number(countRows[0]?.total ?? 0);
    return paginate(items, total, page, pageSize);
  }

  async updateFinding(
    organizationId: string,
    id: string,
    status: FindingStatus,
    resolutionNote?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const eligible = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT f.id ${ownedFindingSql(organizationId)} AND f.id = ${id}
        FOR UPDATE OF f, r
      `;
      if (eligible.length !== 1) throw AppError.notFound('ReviewFinding', id);
      const finding = await tx.reviewFinding.findFirst({
        where: { id, ...ownedFindingWhere(organizationId) },
      });
      if (!finding) throw AppError.notFound('ReviewFinding', id);

      return tx.reviewFinding.update({
        where: { id },
        data: {
          status,
          resolutionNote: resolutionNote ?? finding.resolutionNote,
          resolvedAt:
            status === FindingStatus.RESOLVED ||
            status === FindingStatus.WONT_FIX ||
            status === FindingStatus.ACCEPTED_RISK
              ? new Date()
              : null,
        },
      });
    });
  }
}
