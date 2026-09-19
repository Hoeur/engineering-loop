import { Injectable } from '@nestjs/common';
import { CheckStatus, type CheckType } from '@engloop/types';
import { DEFAULT_REQUIRED_CHECKS, JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import { idempotencyKey } from '@engloop/workflow';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AppError } from '../../common/errors/app-error';
import { ownedArtifactWhere, ownedTestRunWhere } from '../../common/tenant-ownership';

/**
 * Test-run orchestration (spec section 13).
 *
 * The API only records intent and enqueues; the worker is the sole place where
 * commands actually execute, and `passed` is derived from real exit codes —
 * never from anything an agent claims.
 */
@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async trigger(organizationId: string, taskId: string, checks: CheckType[]) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true, key: true, requiredChecks: true, worktreePath: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const selected =
      checks.length > 0
        ? checks
        : task.requiredChecks.length > 0
          ? task.requiredChecks
          : (DEFAULT_REQUIRED_CHECKS as unknown as CheckType[]);

    const testRun = await this.prisma.testRun.create({
      data: {
        taskId,
        status: CheckStatus.QUEUED,
        totalChecks: selected.length,
        worktreePath: task.worktreePath,
        results: {
          create: selected.map((checkType) => ({
            checkType,
            name: checkType.toLowerCase(),
            status: CheckStatus.QUEUED,
            command: '(resolved at execution time from repository configuration)',
          })),
        },
      },
      include: { results: true },
    });

    await this.queues.enqueue(
      QUEUE_NAMES.TESTS,
      JOB_NAMES.RUN_TESTS,
      { testRunId: testRun.id, taskId, checks: selected },
      { jobId: idempotencyKey('tests', testRun.id) },
    );

    return testRun;
  }

  async listForTask(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true, projectId: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const items = await this.prisma.testRun.findMany({
      where: { taskId, ...ownedTestRunWhere(organizationId, task.projectId) },
      orderBy: { createdAt: 'desc' },
      include: { results: { orderBy: { checkType: 'asc' } } },
    });
    return { items, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const owned = await this.prisma.testRun.findFirst({
      where: { id, ...ownedTestRunWhere(organizationId) },
      select: { id: true, task: { select: { projectId: true } } },
    });
    if (!owned) throw AppError.notFound('TestRun', id);

    const run = await this.prisma.testRun.findFirst({
      where: { id, ...ownedTestRunWhere(organizationId, owned.task.projectId) },
      include: {
        results: true,
        artifacts: { where: ownedArtifactWhere(organizationId, owned.task.projectId) },
      },
    });
    if (!run) throw AppError.notFound('TestRun', id);
    return run;
  }

  async list(organizationId: string, page: number, pageSize: number, projectId?: string) {
    const where: Prisma.TestRunWhereInput = {
      ...ownedTestRunWhere(organizationId, projectId),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.testRun.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          results: true,
          task: { select: { id: true, key: true, title: true, projectId: true } },
        },
      }),
      this.prisma.testRun.count({ where }),
    ]);
    return {
      items,
      meta: {
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          hasNext: page * pageSize < total,
          hasPrevious: page > 1,
        },
      },
    };
  }
}
