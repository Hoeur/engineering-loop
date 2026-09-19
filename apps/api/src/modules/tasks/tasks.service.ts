import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ApiErrorCode,
  AuditAction,
  DomainEventName,
  RunStatus,
  TaskStatus,
  type CheckType,
} from '@engloop/types';
import {
  createInitialWorkflowState,
  ENGINEERING_TASK_WORKFLOW,
  HUMAN_ATTENTION_STATUSES,
  idempotencyKey,
  type WorkflowOrchestrator,
} from '@engloop/workflow';
import type {
  CreateTaskDto,
  ListTasksQuery,
  PlanTaskDto,
  RunTaskDto,
  UpdateTaskDto,
} from '@engloop/schemas';
import type { Prisma, Task } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventBus } from '../../infrastructure/events/event-bus';
import { WORKFLOW_ORCHESTRATOR } from '../../infrastructure/queue/bullmq-orchestrator';
import { AppError } from '../../common/errors/app-error';
import { orderBy, paginate, skipTake } from '../../common/pagination';
import {
  ownedAgentRunWhere,
  ownedApprovalWhere,
  ownedArtifactWhere,
  ownedFindingWhere,
  ownedReviewRunWhere,
  ownedTestRunWhere,
  ownedWorkflowRunWhere,
} from '../../common/tenant-ownership';
import { AuditService } from '../audit/audit.service';
import { TaskTransitionService } from './task-transition.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';

const TASK_LIST_INCLUDE = {
  project: { select: { id: true, name: true, key: true, slug: true } },
  repository: { select: { id: true, name: true, defaultBranch: true } },
  assignedAgent: { select: { id: true, name: true, role: true, model: true } },
  _count: { select: { agentRuns: true, testRuns: true, reviewRuns: true, subtasks: true } },
} satisfies Prisma.TaskInclude;

const SORTABLE = ['createdAt', 'updatedAt', 'lastActivityAt', 'priority', 'status', 'key'] as const;
const RETRYABLE_TASK_STATUSES = new Set<TaskStatus>(HUMAN_ATTENTION_STATUSES);

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly transitions: TaskTransitionService,
    @Inject(WORKFLOW_ORCHESTRATOR) private readonly orchestrator: WorkflowOrchestrator,
    private readonly agentRuns: AgentRunsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(organizationId: string, query: ListTasksQuery) {
    const statuses = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;

    const where: Prisma.TaskWhereInput = {
      project: { organizationId },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
      ...(query.epicId ? { epicId: query.epicId } : {}),
      ...(query.featureId ? { featureId: query.featureId } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignedAgentId ? { assignedAgentId: query.assignedAgentId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { key: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: orderBy(query.sortBy, query.sortDir, SORTABLE, 'lastActivityAt'),
        include: TASK_LIST_INCLUDE,
      }),
      this.prisma.task.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async board(organizationId: string, projectId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { projectId, project: { organizationId } },
      orderBy: [{ priority: 'asc' }, { lastActivityAt: 'desc' }],
      include: TASK_LIST_INCLUDE,
    });
    return { items: tasks, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const owned = await this.assertOwned(organizationId, id);
    const task = await this.prisma.task.findFirst({
      where: { id, project: { organizationId } },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            key: true,
            slug: true,
            permissionLevel: true,
            maxReviewCycles: true,
          },
        },
        repository: true,
        epic: { select: { id: true, title: true } },
        feature: { select: { id: true, title: true } },
        assignedAgent: {
          select: {
            id: true,
            name: true,
            role: true,
            model: true,
            provider: { select: { key: true, displayName: true, kind: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        dependencies: {
          include: { dependsOn: { select: { id: true, key: true, title: true, status: true } } },
        },
        dependents: {
          include: { task: { select: { id: true, key: true, title: true, status: true } } },
        },
        subtasks: { select: { id: true, key: true, title: true, status: true, priority: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true } } },
        },
        workflowRuns: {
          where: ownedWorkflowRunWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { steps: { orderBy: { sequence: 'asc' } } },
        },
        agentRuns: {
          where: ownedAgentRunWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        testRuns: {
          where: ownedTestRunWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { results: true },
        },
        reviewRuns: {
          where: ownedReviewRunWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            findings: { where: ownedFindingWhere(organizationId, id, owned.projectId) },
          },
        },
        pullRequests: { orderBy: { createdAt: 'desc' } },
        commits: { orderBy: { committedAt: 'desc' }, take: 20 },
        artifacts: {
          where: ownedArtifactWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        worktrees: { orderBy: { createdAt: 'desc' }, take: 3 },
        approvals: {
          where: ownedApprovalWhere(organizationId, owned.projectId),
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!task) throw AppError.notFound('Task', id);

    return {
      ...task,
      allowedTransitions: this.transitions.allowedNext(task.status),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Allocates the next project-scoped task key inside a transaction so two
   * concurrent creates can never mint the same ENG-nnn.
   */
  private async nextKey(tx: Prisma.TransactionClient, projectId: string): Promise<string> {
    const project = await tx.project.update({
      where: { id: projectId },
      data: { taskSequence: { increment: 1 } },
      select: { key: true, taskSequence: true },
    });
    return `${project.key}-${String(project.taskSequence)}`;
  }

  async create(organizationId: string, dto: CreateTaskDto, createdById?: string): Promise<Task> {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId },
      select: { id: true, organizationId: true, maxTaskAttempts: true },
    });
    if (!project) throw AppError.notFound('Project', dto.projectId);
    await this.validateTaskReferences(organizationId, dto.projectId, dto);

    const task = await this.prisma.$transaction(async (tx) => {
      const key = await this.nextKey(tx, dto.projectId);
      const created = await tx.task.create({
        data: {
          projectId: dto.projectId,
          repositoryId: dto.repositoryId ?? null,
          epicId: dto.epicId ?? null,
          featureId: dto.featureId ?? null,
          parentTaskId: dto.parentTaskId ?? null,
          key,
          title: dto.title,
          description: dto.description,
          objective: dto.objective,
          type: dto.type,
          priority: dto.priority,
          riskLevel: dto.riskLevel,
          acceptanceCriteria: dto.acceptanceCriteria,
          implementationNotes: dto.implementationNotes,
          suggestedFiles: dto.suggestedFiles,
          requiredChecks: dto.requiredChecks as CheckType[],
          maxAttempts: dto.maxAttempts || project.maxTaskAttempts,
          assignedAgentId: dto.assignedAgentId ?? null,
          createdById: createdById ?? null,
        },
      });

      if (dto.dependsOnTaskIds.length > 0) {
        await tx.taskDependency.createMany({
          data: dto.dependsOnTaskIds.map((dependsOnTaskId) => ({
            taskId: created.id,
            dependsOnTaskId,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    this.events.publish(DomainEventName.TASK_CREATED, {
      taskId: task.id,
      taskKey: task.key,
      title: task.title,
      createdBy: createdById ?? 'system',
    });

    await this.audit.recordSafe({
      organizationId: project.organizationId,
      projectId: project.id,
      taskId: task.id,
      action: AuditAction.TASK_TRANSITIONED,
      entityType: 'task',
      entityId: task.id,
      summary: `Created ${task.key}: ${task.title}`,
      metadata: { type: task.type, priority: task.priority },
    });

    return task;
  }

  async update(organizationId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    const existing = await this.assertOwned(organizationId, id);
    await this.validateTaskReferences(organizationId, existing.projectId, dto);
    return this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.riskLevel !== undefined ? { riskLevel: dto.riskLevel } : {}),
        ...(dto.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: dto.acceptanceCriteria }
          : {}),
        ...(dto.implementationNotes !== undefined
          ? { implementationNotes: dto.implementationNotes }
          : {}),
        ...(dto.suggestedFiles !== undefined ? { suggestedFiles: dto.suggestedFiles } : {}),
        ...(dto.requiredChecks !== undefined
          ? { requiredChecks: dto.requiredChecks as CheckType[] }
          : {}),
        ...(dto.maxAttempts !== undefined ? { maxAttempts: dto.maxAttempts } : {}),
        ...(dto.repositoryId !== undefined ? { repositoryId: dto.repositoryId } : {}),
        ...(dto.epicId !== undefined ? { epicId: dto.epicId } : {}),
        ...(dto.featureId !== undefined ? { featureId: dto.featureId } : {}),
        ...(dto.assignedAgentId !== undefined ? { assignedAgentId: dto.assignedAgentId } : {}),
        lastActivityAt: new Date(),
      },
    });
  }

  async transition(
    organizationId: string,
    id: string,
    to: TaskStatus,
    reason?: string,
  ): Promise<Task> {
    await this.assertOwned(organizationId, id);
    return this.transitions.transition(id, to, { reason, actorType: 'USER' });
  }

  async addComment(organizationId: string, taskId: string, body: string, authorId?: string) {
    await this.assertOwned(organizationId, taskId);
    return this.prisma.taskComment.create({
      data: { taskId, body, authorId: authorId ?? null },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async addDependency(
    organizationId: string,
    taskId: string,
    dependsOnTaskId: string,
    type: 'BLOCKS' | 'RELATES_TO' | 'DUPLICATES',
  ) {
    if (taskId === dependsOnTaskId) {
      throw AppError.badRequest(
        ApiErrorCode.TASK_DEPENDENCY_CYCLE,
        'A task cannot depend on itself',
      );
    }
    const task = await this.assertOwned(organizationId, taskId);
    const dependency = await this.assertOwned(organizationId, dependsOnTaskId);
    if (task.projectId !== dependency.projectId) {
      throw AppError.badRequest(
        'TASK_REFERENCE_PROJECT_MISMATCH',
        'Task dependencies must belong to the same project',
      );
    }
    if (await this.wouldCycle(taskId, dependsOnTaskId)) {
      throw AppError.conflict(
        ApiErrorCode.TASK_DEPENDENCY_CYCLE,
        'That dependency would create a cycle',
        { taskId, dependsOnTaskId },
      );
    }
    return this.prisma.taskDependency.create({
      data: { taskId, dependsOnTaskId, type },
    });
  }

  /** Depth-limited DFS over the existing edges before inserting a new one. */
  private async wouldCycle(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    const seen = new Set<string>();
    const stack = [dependsOnTaskId];
    let guard = 0;

    while (stack.length > 0 && guard++ < 500) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      if (current === taskId) return true;
      seen.add(current);
      const edges = await this.prisma.taskDependency.findMany({
        where: { taskId: current },
        select: { dependsOnTaskId: true },
      });
      stack.push(...edges.map((edge) => edge.dependsOnTaskId));
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Actions — these enqueue work; the worker executes it.
  // -------------------------------------------------------------------------

  async plan(organizationId: string, id: string, dto: PlanTaskDto) {
    const task = await this.prisma.task.findFirst({
      where: { id, project: { organizationId } },
      include: {
        project: {
          select: { id: true, organizationId: true, maxReviewCycles: true, permissionLevel: true },
        },
      },
    });
    if (!task) throw AppError.notFound('Task', id);

    return this.startWorkflow(organizationId, task.id, {
      workflowKey: ENGINEERING_TASK_WORKFLOW.key,
      skipPlanning: false,
      force: false,
      planOnly: true,
      requirement: dto.requirement ?? task.description,
      constraints: dto.constraints,
      targetPaths: dto.targetPaths,
    });
  }

  async run(organizationId: string, id: string, dto: RunTaskDto) {
    return this.startWorkflow(organizationId, id, {
      workflowKey: dto.workflowKey,
      skipPlanning: dto.skipPlanning,
      force: dto.force,
      planOnly: false,
    });
  }

  private async startWorkflow(
    organizationId: string,
    taskId: string,
    options: {
      workflowKey: string;
      skipPlanning: boolean;
      force: boolean;
      planOnly: boolean;
      requirement?: string;
      constraints?: string[];
      targetPaths?: string[];
    },
  ) {
    // Lock the owned task row so concurrent API requests serialize the active-run
    // check and create. Force still permits an additional run after the lock.
    const { task, run, key } = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT t.id FROM tasks t
        JOIN projects p ON p.id = t."projectId"
        WHERE t.id = ${taskId} AND p."organizationId" = ${organizationId}
        FOR UPDATE OF t
      `;
      if (owned.length !== 1) throw AppError.notFound('Task', taskId);

      const task = await tx.task.findFirst({
        where: { id: taskId, project: { organizationId } },
        include: {
          project: {
            select: {
              id: true,
              organizationId: true,
              maxReviewCycles: true,
              maxTaskAttempts: true,
              permissionLevel: true,
            },
          },
        },
      });
      if (!task) throw AppError.notFound('Task', taskId);
      if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED) {
        throw AppError.conflict(
          ApiErrorCode.TASK_INVALID_TRANSITION,
          `${task.key} cannot start a workflow from ${task.status}`,
        );
      }

      const active = await tx.workflowRun.findFirst({
        where: { taskId, status: { in: [RunStatus.PENDING, RunStatus.RUNNING] } },
      });
      if (active && !options.force) {
        throw AppError.conflict(
          ApiErrorCode.TASK_ALREADY_RUNNING,
          `${task.key} already has a workflow run in progress`,
          { workflowRunId: active.id },
        );
      }
      if (task.attemptCount >= task.maxAttempts && !options.force) {
        throw AppError.conflict(
          ApiErrorCode.TASK_MAX_ATTEMPTS_REACHED,
          `${task.key} has used all ${String(task.maxAttempts)} attempts; approve a retry to continue`,
        );
      }

      const state = createInitialWorkflowState({
        maxReviewCycles: task.project.maxReviewCycles,
        maxAttempts: task.maxAttempts,
        skipPlanning: options.skipPlanning,
        createPullRequest: !options.planOnly,
        permissionLevel: task.project.permissionLevel,
      });
      const key = idempotencyKey('wf', taskId, task.attemptCount, randomUUID());
      const run = await tx.workflowRun.create({
        data: {
          definitionKey: options.workflowKey,
          projectId: task.projectId,
          taskId: task.id,
          status: RunStatus.PENDING,
          state: {
            ...state,
            planOnly: options.planOnly,
            requirement: options.requirement ?? task.description,
            constraints: options.constraints ?? [],
            targetPaths: options.targetPaths ?? [],
          },
          idempotencyKey: key,
        },
      });
      return { task, run, key };
    });

    try {
      await this.orchestrator.start({
        workflowRunId: run.id,
        definitionKey: options.workflowKey,
        taskId: task.id,
        projectId: task.projectId,
        organizationId: task.project.organizationId,
        traceId: key,
        idempotencyKey: key,
      });
    } catch (error) {
      await this.prisma.workflowRun.updateMany({
        where: { id: run.id, status: RunStatus.PENDING },
        data: { status: RunStatus.FAILED, error: 'Workflow enqueue failed', completedAt: new Date() },
      });
      throw error;
    }

    this.events.publish(DomainEventName.WORKFLOW_STARTED, {
      workflowRunId: run.id,
      definitionKey: options.workflowKey,
      status: RunStatus.PENDING,
    });

    return run;
  }

  async cancel(organizationId: string, id: string, reason: string) {
    const cancelled = await this.transitions.cancelWithWorkflows(organizationId, id, reason);
    await Promise.allSettled([
      ...cancelled.workflowRunIds.map((runId) => this.orchestrator.cancel(runId, reason)),
      this.agentRuns.notifyCommittedCancellations(
        organizationId, cancelled.agentRunIds, reason, true,
      ),
    ]);
    return { task: cancelled.task, cancelledRuns: cancelled.workflowRunIds };
  }

  async retry(organizationId: string, id: string, resetAttempts: boolean) {
    const task = await this.prisma.task.findFirst({
      where: { id, project: { organizationId } },
    });
    if (!task) throw AppError.notFound('Task', id);

    if (!RETRYABLE_TASK_STATUSES.has(task.status)) {
      throw AppError.conflict(
        ApiErrorCode.TASK_INVALID_TRANSITION,
        `${task.key} cannot be retried from ${task.status}`,
      );
    }

    const active = await this.prisma.workflowRun.findFirst({
      where: {
        taskId: id,
        projectId: task.projectId,
        project: { organizationId },
        status: { in: [RunStatus.PENDING, RunStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) {
      throw AppError.conflict(
        ApiErrorCode.TASK_ALREADY_RUNNING,
        `${task.key} already has a workflow run in progress`,
        { workflowRunId: active.id },
      );
    }

    if (resetAttempts) {
      const claimed = await this.prisma.task.updateMany({
        where: { id, status: task.status },
        data: { attemptCount: 0, reviewCycle: 0, blockedReason: null },
      });
      if (claimed.count !== 1) {
        throw AppError.conflict('CONFLICT', 'Task status changed before retry started');
      }
    }

    await this.transitions.transitionThrough(id, TaskStatus.QUEUED, { reason: 'Manual retry' });
    return this.run(organizationId, id, {
      workflowKey: ENGINEERING_TASK_WORKFLOW.key,
      skipPlanning: true,
      force: false,
    });
  }

  async approve(
    organizationId: string,
    id: string,
    note: string | undefined,
    createPullRequest: boolean,
    userId?: string,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id, project: { organizationId } },
      include: { project: { select: { id: true, organizationId: true } } },
    });
    if (!task) throw AppError.notFound('Task', id);

    const blocking = await this.prisma.reviewFinding.count({
      where: {
        reviewRun: { taskId: id },
        status: { in: ['OPEN', 'FIXING'] },
        severity: { in: ['CRITICAL', 'HIGH'] },
      },
    });
    if (blocking > 0) {
      throw AppError.conflict(
        ApiErrorCode.APPROVAL_REQUIRED,
        `${String(blocking)} blocking finding(s) are still open; resolve or explicitly accept them first`,
        { blocking },
      );
    }

    const updated = await this.transitions.transition(id, TaskStatus.APPROVED, {
      reason: note ?? 'Approved by a human reviewer',
      actorType: 'USER',
    });

    await this.prisma.approval.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        kind: createPullRequest ? 'PULL_REQUEST' : 'IMPLEMENTATION',
        status: 'APPROVED',
        note: note ?? null,
        requestedById: userId ?? null,
        decidedById: userId ?? null,
        decidedAt: new Date(),
      },
    });

    this.events.publish(DomainEventName.TASK_REVIEW_APPROVED, {
      taskId: task.id,
      reviewRunId: '',
      decision: 'APPROVED',
    });

    return updated;
  }

  private async validateTaskReferences(
    organizationId: string,
    projectId: string,
    dto: CreateTaskDto | UpdateTaskDto,
  ): Promise<void> {
    const checks: Array<Promise<number>> = [];
    const labels: string[] = [];
    const add = (label: string, check: Promise<number>): void => {
      labels.push(label);
      checks.push(check);
    };

    if (dto.repositoryId) {
      add(
        'repositoryId',
        this.prisma.repository.count({
          where: { id: dto.repositoryId, projectId, project: { organizationId } },
        }),
      );
    }
    if (dto.epicId) {
      add(
        'epicId',
        this.prisma.epic.count({ where: { id: dto.epicId, projectId, project: { organizationId } } }),
      );
    }
    if (dto.featureId) {
      add(
        'featureId',
        this.prisma.feature.count({
          where: { id: dto.featureId, projectId, project: { organizationId } },
        }),
      );
    }
    if (dto.parentTaskId) {
      add(
        'parentTaskId',
        this.prisma.task.count({
          where: { id: dto.parentTaskId, projectId, project: { organizationId } },
        }),
      );
    }
    if (dto.assignedAgentId) {
      add(
        'assignedAgentId',
        this.prisma.agent.count({
          where: {
            id: dto.assignedAgentId,
            organizationId,
            OR: [{ projectId: null }, { projectId }],
          },
        }),
      );
    }
    if ('dependsOnTaskIds' in dto && dto.dependsOnTaskIds.length > 0) {
      const dependencyIds = [...new Set(dto.dependsOnTaskIds)];
      labels.push('dependsOnTaskIds');
      checks.push(
        this.prisma.task.count({
          where: { id: { in: dependencyIds }, projectId, project: { organizationId } },
        }).then((count) => (count === dependencyIds.length ? 1 : 0)),
      );
    }

    const results = await Promise.all(checks);
    const invalid = results.findIndex((count) => count !== 1);
    if (invalid >= 0) {
      throw AppError.badRequest(
        'TASK_REFERENCE_PROJECT_MISMATCH',
        `${labels[invalid] ?? 'Task reference'} must belong to the authenticated organization and project`,
      );
    }
  }

  async assertOwned(organizationId: string, id: string): Promise<{ id: string; projectId: string }> {
    const task = await this.prisma.task.findFirst({
      where: { id, project: { organizationId } },
      select: { id: true, projectId: true },
    });
    if (!task) throw AppError.notFound('Task', id);
    return task;
  }
}
