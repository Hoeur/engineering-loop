import { Injectable } from '@nestjs/common';
import { AgentRunStatus, AuditAction } from '@engloop/types';
import { JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { ownedAgentRunWhere, ownedArtifactWhere } from '../../common/tenant-ownership';

@Injectable()
export class AgentRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page: number;
      pageSize: number;
      taskId?: string;
      projectId?: string;
      workflowRunId?: string;
      role?: string;
      status?: string;
      sortDir: 'asc' | 'desc';
    },
  ) {
    const where: Prisma.AgentRunWhereInput = {
      ...ownedAgentRunWhere(organizationId, query.projectId),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.workflowRunId ? { workflowRunId: query.workflowRunId } : {}),
      ...(query.role ? { role: query.role as Prisma.EnumAgentRoleFilter['equals'] } : {}),
      ...(query.status ? { status: query.status as AgentRunStatus } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.agentRun.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: { createdAt: query.sortDir },
        include: {
          task: { select: { id: true, key: true, title: true, projectId: true } },
          agent: { select: { id: true, name: true } },
        },
      }),
      this.prisma.agentRun.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async listForTask(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true, projectId: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const items = await this.prisma.agentRun.findMany({
      where: { taskId, ...ownedAgentRunWhere(organizationId, task.projectId) },
      orderBy: { createdAt: 'desc' },
      include: { agent: { select: { id: true, name: true } } },
    });
    return { items, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const owner = await this.prisma.agentRun.findFirst({
      where: { id, ...ownedAgentRunWhere(organizationId) },
      select: {
        task: { select: { projectId: true } },
        workflowRun: { select: { projectId: true } },
        workflowStep: { select: { workflowRun: { select: { projectId: true } } } },
      },
    });
    const projectId = owner ? this.canonicalProjectId(owner) : null;
    if (!projectId) throw AppError.notFound('AgentRun', id);

    const run = await this.prisma.agentRun.findFirst({
      where: {
        id,
        ...ownedAgentRunWhere(organizationId, projectId),
      },
      include: {
        messages: { orderBy: { sequence: 'asc' } },
        artifacts: { where: ownedArtifactWhere(organizationId, projectId) },
        task: { select: { id: true, key: true, title: true, projectId: true } },
        agent: { select: { id: true, name: true, role: true } },
        provider: { select: { key: true, displayName: true, kind: true } },
      },
    });
    if (!run) throw AppError.notFound('AgentRun', id);
    return run;
  }

  async cancel(organizationId: string, id: string, reason: string) {
    const run = await this.prisma.agentRun.findFirst({
      where: {
        id,
        ...ownedAgentRunWhere(organizationId),
      },
      include: {
        task: { select: { projectId: true, project: { select: { organizationId: true } } } },
        workflowRun: {
          select: { projectId: true, project: { select: { organizationId: true } } },
        },
        workflowStep: {
          select: {
            workflowRun: {
              select: { projectId: true, project: { select: { organizationId: true } } },
            },
          },
        },
      },
    });
    if (!run) throw AppError.notFound('AgentRun', id);

    if (run.status !== AgentRunStatus.PENDING && run.status !== AgentRunStatus.RUNNING) {
      return run;
    }

    const ownerProjects = [
      run.task?.projectId,
      run.workflowRun?.projectId,
      run.workflowStep?.workflowRun.projectId,
    ].filter((projectId): projectId is string => Boolean(projectId));
    const projectId = ownerProjects[0];
    if (!projectId || ownerProjects.some((ownerProjectId) => ownerProjectId !== projectId)) {
      throw AppError.conflict('CONFLICT', 'Agent run owners do not belong to one project');
    }

    const claimed = await this.prisma.agentRun.updateMany({
      where: {
        id,
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
      },
      data: { status: AgentRunStatus.CANCELLED, completedAt: new Date(), errorMessage: reason },
    });
    if (claimed.count !== 1) {
      throw AppError.conflict('CONFLICT', 'Agent run changed before cancellation completed');
    }

    await this.notifyCommittedCancellations(organizationId, [id], reason);

    return this.prisma.agentRun.findUniqueOrThrow({ where: { id } });
  }

  /** Signals and audits rows already claimed by a parent cancellation transaction. */
  async notifyCommittedCancellations(
    organizationId: string,
    ids: string[],
    reason: string,
    auditAlreadyPersisted = false,
  ): Promise<void> {
    if (ids.length === 0) return;
    const runs = await this.prisma.agentRun.findMany({
      where: {
        id: { in: ids },
        status: AgentRunStatus.CANCELLED,
        ...ownedAgentRunWhere(organizationId),
      },
      include: {
        task: { select: { projectId: true } },
        workflowRun: { select: { projectId: true } },
        workflowStep: { select: { workflowRun: { select: { projectId: true } } } },
      },
    });

    await Promise.all(runs.map(async (run) => {
      const projectId = this.canonicalProjectId(run);
      if (!projectId) return;
      // The database claim is authoritative. The executor also polls this row,
      // so a transient queue outage cannot resurrect a committed cancellation.
      try {
        await this.queues.enqueue(
          QUEUE_NAMES.AGENT,
          `${JOB_NAMES.RUN_AGENT}.cancel`,
          { agentRunId: run.id, reason },
          { jobId: `agent-cancel:${run.id}` },
        );
      } catch {
        // Polling in AgentExecutor observes the committed cancellation directly.
      }
      if (!auditAlreadyPersisted) {
        await this.audit.recordSafe({
          organizationId,
          projectId,
          taskId: run.taskId,
          action: AuditAction.AGENT_STOPPED,
          entityType: 'agent_run',
          entityId: run.id,
          summary: `Cancelled ${run.role} run on ${run.providerKey}`,
          metadata: { reason },
        });
      }
    }));
  }

  async cancelActiveForTask(
    organizationId: string,
    taskId: string,
    projectId: string,
    reason: string,
  ): Promise<void> {
    const runs = await this.prisma.agentRun.findMany({
      where: {
        taskId,
        ...ownedAgentRunWhere(organizationId, projectId),
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
      },
      select: { id: true },
    });
    await this.cancelActive(organizationId, runs.map((run) => run.id), reason);
  }

  async cancelActiveForWorkflow(
    organizationId: string,
    workflowRunId: string,
    projectId: string,
    reason: string,
  ): Promise<void> {
    const runs = await this.prisma.agentRun.findMany({
      where: {
        ...ownedAgentRunWhere(organizationId, projectId),
        OR: [{ workflowRunId }, { workflowStep: { workflowRunId } }],
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
      },
      select: { id: true },
    });
    await this.cancelActive(organizationId, runs.map((run) => run.id), reason);
  }

  private async cancelActive(organizationId: string, ids: string[], reason: string): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.cancel(organizationId, id, reason);
        } catch (error) {
          if (error instanceof AppError && error.code === 'CONFLICT') return;
          throw error;
        }
      }),
    );
  }

  private canonicalProjectId(owner: {
    task: { projectId: string } | null;
    workflowRun: { projectId: string } | null;
    workflowStep: { workflowRun: { projectId: string } } | null;
  }): string | null {
    const projectIds = [
      owner.task?.projectId,
      owner.workflowRun?.projectId,
      owner.workflowStep?.workflowRun.projectId,
    ].filter((projectId): projectId is string => Boolean(projectId));
    const projectId = projectIds[0];
    return projectId && projectIds.every((candidate) => candidate === projectId) ? projectId : null;
  }
}
