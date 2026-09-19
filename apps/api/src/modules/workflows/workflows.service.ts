import { Inject, Injectable } from '@nestjs/common';
import { AgentRunStatus, RunStatus } from '@engloop/types';
import {
  ENGINEERING_TASK_WORKFLOW,
  WORKFLOW_REGISTRY,
  type WorkflowOrchestrator,
} from '@engloop/workflow';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WORKFLOW_ORCHESTRATOR } from '../../infrastructure/queue/bullmq-orchestrator';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/pagination';
import {
  ownedAgentRunWhere,
  ownedFindingWhere,
  ownedReviewRunWhere,
  ownedTestRunWhere,
  ownedWorkflowRunWhere,
} from '../../common/tenant-ownership';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { TaskTransitionService } from '../tasks/task-transition.service';

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW_ORCHESTRATOR) private readonly orchestrator: WorkflowOrchestrator,
    private readonly agentRuns: AgentRunsService,
    private readonly transitions: TaskTransitionService,
  ) {}

  /** Definitions live in code (spec section 30); this exposes them read-only. */
  definitions() {
    const items = Object.values(WORKFLOW_REGISTRY).map((definition) => ({
      key: definition.key,
      version: definition.version,
      name: definition.name,
      description: definition.description,
      steps: definition.steps,
    }));
    return { items, meta: { orchestrator: this.orchestrator.name } };
  }

  async listRuns(
    organizationId: string,
    query: {
      page: number;
      pageSize: number;
      taskId?: string;
      projectId?: string;
      status?: string;
      sortDir: 'asc' | 'desc';
    },
  ) {
    const where: Prisma.WorkflowRunWhereInput = {
      ...ownedWorkflowRunWhere(organizationId),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status as RunStatus } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workflowRun.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: { createdAt: query.sortDir },
        include: {
          task: { select: { id: true, key: true, title: true, status: true } },
          project: { select: { id: true, name: true, key: true } },
          steps: { orderBy: { sequence: 'asc' } },
          _count: { select: { agentRuns: true, testRuns: true, reviewRuns: true } },
        },
      }),
      this.prisma.workflowRun.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  /** Payload behind the live engineering run screen (spec section 28). */
  async findOne(organizationId: string, id: string) {
    const owned = await this.prisma.workflowRun.findFirst({
      where: { id, ...ownedWorkflowRunWhere(organizationId) },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        task: { select: { projectId: true } },
      },
    });
    if (!owned || (owned.task && owned.task.projectId !== owned.projectId)) {
      throw AppError.notFound('WorkflowRun', id);
    }

    const run = await this.prisma.workflowRun.findFirst({
      where: { id, ...ownedWorkflowRunWhere(organizationId, owned.projectId) },
      include: {
        task: {
          select: {
            id: true,
            key: true,
            title: true,
            status: true,
            attemptCount: true,
            maxAttempts: true,
            actualCost: true,
            branchName: true,
          },
        },
        project: { select: { id: true, name: true, key: true, maxReviewCycles: true } },
        steps: {
          orderBy: { sequence: 'asc' },
          include: {
            agentRuns: {
              where: ownedAgentRunWhere(organizationId, owned.projectId),
              select: {
                id: true,
                role: true,
                providerKey: true,
                model: true,
                status: true,
                totalTokens: true,
                estimatedCost: true,
                durationMs: true,
                startedAt: true,
                completedAt: true,
              },
            },
            testRuns: {
              where: {
                ...ownedTestRunWhere(organizationId, owned.projectId),
                taskId: owned.taskId ?? '__workflow_without_task__',
              },
              include: { results: true },
            },
            reviewRuns: {
              where: {
                ...ownedReviewRunWhere(organizationId, owned.projectId),
                taskId: owned.taskId ?? '__workflow_without_task__',
              },
              include: {
                findings: owned.taskId
                  ? { where: ownedFindingWhere(organizationId, owned.taskId, owned.projectId) }
                  : false,
              },
            },
          },
        },
      },
    });
    if (!run) throw AppError.notFound('WorkflowRun', id);

    const definition = WORKFLOW_REGISTRY[run.definitionKey] ?? ENGINEERING_TASK_WORKFLOW;
    const completed = run.steps.filter((step) => step.status === RunStatus.SUCCEEDED).length;

    return {
      ...run,
      definition: { key: definition.key, name: definition.name, steps: definition.steps },
      progress: {
        completed,
        total: definition.steps.length,
        percent: Math.round((completed / definition.steps.length) * 100),
      },
    };
  }

  async cancel(organizationId: string, id: string, reason: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id, ...ownedWorkflowRunWhere(organizationId) },
      include: { task: { select: { projectId: true } } },
    });
    if (!run) throw AppError.notFound('WorkflowRun', id);
    if (run.task && run.task.projectId !== run.projectId) {
      throw AppError.conflict('CONFLICT', 'Workflow run task does not belong to its project');
    }
    if (
      run.status !== RunStatus.PENDING &&
      run.status !== RunStatus.RUNNING &&
      run.status !== RunStatus.WAITING_FOR_HUMAN
    ) {
      throw AppError.conflict('CONFLICT', `Workflow run is already ${run.status}`);
    }
    let workflowRunIds: string[];
    let agentRunIds: string[];
    if (run.taskId) {
      const cancelled = await this.transitions.cancelWithWorkflows(
        organizationId,
        run.taskId,
        reason,
        id,
      );
      workflowRunIds = cancelled.workflowRunIds;
      agentRunIds = cancelled.agentRunIds;
    } else {
      agentRunIds = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.workflowRun.updateMany({
          where: {
            id,
            projectId: run.projectId,
            project: { organizationId },
            status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
          },
          data: {
            status: RunStatus.CANCELLED,
            error: reason,
            completedAt: new Date(),
            currentStepKey: null,
          },
        });
        if (claimed.count !== 1) {
          throw AppError.conflict('CONFLICT', 'Workflow run finished before cancellation was claimed');
        }
        await tx.workflowStep.updateMany({
          where: { workflowRunId: id, status: RunStatus.RUNNING },
          data: { status: RunStatus.CANCELLED, error: reason, finishedAt: new Date() },
        });
        const agentRunWhere: Prisma.AgentRunWhereInput = {
          ...ownedAgentRunWhere(organizationId, run.projectId),
          status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
          OR: [{ workflowRunId: id }, { workflowStep: { workflowRunId: id } }],
        };
        const agentRuns = await tx.agentRun.updateManyAndReturn({
          where: agentRunWhere,
          data: {
            status: AgentRunStatus.CANCELLED,
            completedAt: new Date(),
            errorMessage: reason,
          },
          select: { id: true, role: true, providerKey: true, taskId: true },
        });
        if (agentRuns.length > 0) {
          await tx.auditLog.createMany({
            data: agentRuns.map((agentRun) => ({
              organizationId,
              projectId: run.projectId,
              taskId: agentRun.taskId,
              action: 'AGENT_STOPPED',
              entityType: 'agent_run',
              entityId: agentRun.id,
              summary: `Cancelled ${agentRun.role} run on ${agentRun.providerKey}`,
              metadata: { reason } as Prisma.InputJsonValue,
              actorType: 'USER',
            })),
          });
        }
        return agentRuns.map((agentRun) => agentRun.id);
      });
      workflowRunIds = [id];
    }
    await Promise.allSettled(
      [
        ...workflowRunIds.map((workflowRunId) =>
          this.orchestrator.cancel(workflowRunId, reason),
        ),
        this.agentRuns.notifyCommittedCancellations(
          organizationId, agentRunIds, reason, true,
        ),
      ],
    );
    return { workflowRunId: id, cancelledWorkflowRunIds: workflowRunIds, requested: true, reason };
  }
}
