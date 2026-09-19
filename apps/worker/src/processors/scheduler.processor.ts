import { RunStatus, type ScheduleType, TaskType } from '@engloop/types';
import { retryOnUniqueViolation } from '@engloop/db';
import { parseExpression } from 'cron-parser';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context';

interface FireSchedulePayload {
  scheduleId: string;
  manual?: boolean;
}

const TITLE_BY_TYPE: Record<ScheduleType, string> = {
  REPOSITORY_REVIEW: 'Scheduled repository review',
  TECH_DEBT_ANALYSIS: 'Scheduled technical-debt analysis',
  SECURITY_SCAN: 'Scheduled security scan',
  DEPENDENCY_REVIEW: 'Scheduled dependency review',
  TEST_SUITE: 'Scheduled test-suite run',
  BACKLOG_ANALYSIS: 'Scheduled backlog analysis',
  ARCHITECTURE_REVIEW: 'Scheduled architecture review',
  UI_QUALITY_REVIEW: 'Scheduled UI quality review',
  TASK_EXECUTION: 'Scheduled task execution',
};

const TYPE_BY_SCHEDULE: Record<ScheduleType, TaskType> = {
  REPOSITORY_REVIEW: TaskType.INVESTIGATION,
  TECH_DEBT_ANALYSIS: TaskType.REFACTOR,
  SECURITY_SCAN: TaskType.SECURITY,
  DEPENDENCY_REVIEW: TaskType.DEVOPS,
  TEST_SUITE: TaskType.TEST,
  BACKLOG_ANALYSIS: TaskType.INVESTIGATION,
  ARCHITECTURE_REVIEW: TaskType.INVESTIGATION,
  UI_QUALITY_REVIEW: TaskType.UI,
  TASK_EXECUTION: TaskType.FEATURE,
};

/**
 * Fires a schedule by creating a backlog task for it.
 *
 * Creating work rather than executing it directly keeps every scheduled activity
 * visible on the board, auditable and subject to the same permission gates.
 */
export const createSchedulerProcessor =
  (worker: WorkerContext) =>
  async (job: Job<FireSchedulePayload>): Promise<unknown> => {
    const schedule = await worker.prisma.schedule.findUnique({
      where: { id: job.data.scheduleId },
      include: { project: { select: { id: true, key: true, organizationId: true } } },
    });

    if (!schedule) return { skipped: 'schedule no longer exists' };
    if (!schedule.enabled && !job.data.manual) return { skipped: 'schedule disabled' };

    // Retry the whole transaction: a collision means another fire took this
    // sequence number, so the retry re-reads the incremented one.
    const task = await retryOnUniqueViolation(() =>
      worker.prisma.$transaction(async (tx) => {
        const project = await tx.project.update({
          where: { id: schedule.projectId },
          data: { taskSequence: { increment: 1 } },
          select: { key: true, taskSequence: true },
        });

        return tx.task.create({
          data: {
            projectId: schedule.projectId,
            repositoryId: schedule.repositoryId,
            key: `${project.key}-${String(project.taskSequence)}`,
            title: `${TITLE_BY_TYPE[schedule.type]} — ${schedule.name}`,
            objective: `Triggered by schedule "${schedule.name}" (${schedule.cronExpression}).`,
            description: `Automatically created by the EngLoop scheduler.`,
            type: TYPE_BY_SCHEDULE[schedule.type],
            priority: 'MEDIUM',
            riskLevel: 'LOW',
          },
        });
      }),
    );

    let nextRunAt: Date | null = null;
    try {
      nextRunAt = parseExpression(schedule.cronExpression, { tz: schedule.timezone })
        .next()
        .toDate();
    } catch {
      nextRunAt = null;
    }

    await worker.prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), nextRunAt, lastStatus: RunStatus.SUCCEEDED },
    });

    worker.logger.info(
      { scheduleId: schedule.id, taskKey: task.key, type: schedule.type },
      'schedule.fired',
    );

    return { scheduleId: schedule.id, createdTaskId: task.id, taskKey: task.key };
  };
