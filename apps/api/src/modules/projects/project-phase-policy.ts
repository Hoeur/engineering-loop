import type { Prisma } from '@engloop/db';
import { ApiErrorCode, ProjectPhaseStatus, RunStatus } from '@engloop/types';
import { ACTIVE_TASK_STATUSES } from '@engloop/workflow';
import { AppError } from '../../common/errors/app-error';

export function assertDraftPhase(status: ProjectPhaseStatus) {
  if (status !== ProjectPhaseStatus.DRAFT)
    throw AppError.conflict(
      ApiErrorCode.PHASE_LOCKED,
      status === ProjectPhaseStatus.ACCEPTED
        ? 'Accepted phases require an evidence-gated revision'
        : 'Reopen the active phase before editing its planning contract',
    );
}

export async function assertEditablePhaseTask(
  tx: Prisma.TransactionClient,
  projectId: string,
  taskId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM tasks WHERE id = ${taskId} AND "projectId" = ${projectId} FOR UPDATE
  `;
  if (rows.length === 0) throw AppError.notFound('Task', taskId);
  const task = await tx.task.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true,
      key: true,
      title: true,
      phaseId: true,
      status: true,
      workflowRuns: {
        where: {
          status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
        },
        select: { id: true },
        take: 1,
      },
      agentRuns: {
        where: { status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!task) throw AppError.notFound('Task', taskId);
  if (
    ACTIVE_TASK_STATUSES.includes(task.status) ||
    task.workflowRuns.length ||
    task.agentRuns.length
  )
    throw AppError.conflict(
      ApiErrorCode.TASK_PHASE_LOCKED,
      'Phase membership cannot change while a task has active execution',
    );
  return task;
}
