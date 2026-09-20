import { DomainEventName, RunStatus, TaskStatus, type WorkflowStepKey } from '@engloop/types';
import { getWorkflowDefinition, type WorkflowDecision } from '@engloop/workflow';
import type { Prisma, WorkflowRun, WorkflowStep } from '@engloop/db';
import type { WorkerContext } from '../context';
import { TaskTransitions } from '../services/task-transitions';
import { STEP_HANDLERS, type StepExecutionContext, type StepOutcome } from './steps';
import { CYCLE_STEPS, guardDecision, readState, type PersistedWorkflowState } from './state';

/** A workflow run loaded with its step rows — what every engine method works on. */
type LoadedRun = WorkflowRun & { steps: WorkflowStep[] };

/**
 * Reads `Project.settings.uiQa.enabled`.
 *
 * `settings` is an unvalidated JSON column, so every shape that is not an
 * explicit `true` means off. Most repositories have no UI, and a project that
 * never opted in must not pay for a UI review.
 */
const isUiQaEnabled = (settings: Prisma.JsonValue | null | undefined): boolean => {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return false;
  const uiQa = (settings as Record<string, unknown>).uiQa;
  if (typeof uiQa !== 'object' || uiQa === null || Array.isArray(uiQa)) return false;
  return (uiQa as Record<string, unknown>).enabled === true;
};
/**
 * Reads `Project.settings.documentation.enabled`.
 *
 * Mirrors `isUiQaEnabled` but inverts the default: every repository with an
 * approved diff benefits from documentation, so this is opt-**out**. Only an
 * explicit `false` disables it; any other shape in this unvalidated JSON column
 * leaves it on, and the step is optional, so being wrong degrades a run rather
 * than failing one.
 */
const isDocumentationEnabled = (settings: Prisma.JsonValue | null | undefined): boolean => {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return true;
  const documentation = (settings as Record<string, unknown>).documentation;
  if (typeof documentation !== 'object' || documentation === null || Array.isArray(documentation)) {
    return true;
  }
  return (documentation as Record<string, unknown>).enabled !== false;
};

const STEP_LEASE_MS = 20_000;
const STEP_HEARTBEAT_MS = 5_000;

export interface AdvanceResult {
  workflowRunId: string;
  decision: WorkflowDecision['type'];
  stepKey?: WorkflowStepKey;
  status: RunStatus;
  reason: string;
  shouldContinue: boolean;
}

/**
 * The workflow engine (spec sections 7 and 30).
 *
 * One `advance()` call executes at most one step, persists everything, and says
 * whether it should be called again. That shape is what makes the loop
 * crash-safe, idempotent and portable: BullMQ re-enqueues today, a Temporal
 * workflow would call the same method.
 */
export class WorkflowEngine {
  private readonly transitions: TaskTransitions;

  constructor(private readonly worker: WorkerContext) {
    this.transitions = new TaskTransitions(worker.prisma, worker.audit, worker.logger);
  }

  async advance(workflowRunId: string, traceId: string): Promise<AdvanceResult> {
    const { prisma, logger } = this.worker;

    const run = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    if (!run) {
      return {
        workflowRunId,
        decision: 'FAIL',
        status: RunStatus.FAILED,
        reason: 'Workflow run no longer exists',
        shouldContinue: false,
      };
    }

    if (
      run.status === RunStatus.SUCCEEDED ||
      run.status === RunStatus.FAILED ||
      run.status === RunStatus.CANCELLED
    ) {
      return {
        workflowRunId,
        decision: 'COMPLETE',
        status: run.status,
        reason: `Run already ${run.status}`,
        shouldContinue: false,
      };
    }

    if (!run.taskId) {
      if (!(await this.finishRun(run.id, RunStatus.FAILED, 'Workflow run has no task'))) {
        return this.staleResult(run.id);
      }
      return {
        workflowRunId,
        decision: 'FAIL',
        status: RunStatus.FAILED,
        reason: 'Workflow run has no task',
        shouldContinue: false,
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: run.taskId },
      include: {
        repository: true,
        project: {
          select: {
            id: true,
            organizationId: true,
            maxReviewCycles: true,
            permissionLevel: true,
            settings: true,
          },
        },
      },
    });
    if (!task) {
      if (!(await this.finishRun(run.id, RunStatus.FAILED, 'Task no longer exists'))) {
        return this.staleResult(run.id);
      }
      return {
        workflowRunId,
        decision: 'FAIL',
        status: RunStatus.FAILED,
        reason: 'Task no longer exists',
        shouldContinue: false,
      };
    }

    if (task.projectId !== run.projectId) {
      const reason = 'Workflow run task does not belong to its project';
      if (!(await this.finishRun(run.id, RunStatus.FAILED, reason))) {
        return this.staleResult(run.id);
      }
      return {
        workflowRunId,
        decision: 'FAIL',
        status: RunStatus.FAILED,
        reason,
        shouldContinue: false,
      };
    }

    const state: PersistedWorkflowState = {
      ...readState(run),
      maxReviewCycles: task.project.maxReviewCycles,
      maxAttempts: task.maxAttempts,
      permissionLevel: task.project.permissionLevel,
      // Resolved here, in the engine, so the router keeps seeing a plain boolean
      // and stays a pure function of its state.
      uiQaEnabled: isUiQaEnabled(task.project.settings),
      documentationEnabled: isDocumentationEnabled(task.project.settings),
    };

    const definition = getWorkflowDefinition(run.definitionKey);
    const decision = guardDecision(definition.decide(state), state, run.steps);

    const runLogger = logger.withContext({
      traceId,
      workflowRunId: run.id,
      taskId: task.id,
      taskKey: task.key,
      projectId: task.projectId,
      organizationId: task.project.organizationId,
    });
    runLogger.info({ decision: decision.type, reason: decision.reason }, 'workflow.decision');

    let claimedRun = run;
    if (run.status === RunStatus.PENDING) {
      const claimed = await prisma.workflowRun.updateMany({
        where: { id: run.id, status: RunStatus.PENDING },
        data: { status: RunStatus.RUNNING, startedAt: new Date() },
      });
      if (claimed.count !== 1) return this.staleResult(run.id);
      const started = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        select: { status: true, updatedAt: true },
      });
      if (!started || started.status !== RunStatus.RUNNING) return this.staleResult(run.id);
      claimedRun = { ...run, status: RunStatus.RUNNING, updatedAt: started.updatedAt };
    }

    switch (decision.type) {
      case 'COMPLETE':
        if (!(await this.transitions.finishWorkflow(
          run.id, task.id, RunStatus.SUCCEEDED, TaskStatus.COMPLETED, decision.reason, traceId,
        ))) {
          return this.staleResult(run.id);
        }
        await this.worker.gitManager.releaseWorktree(task.id).catch(() => undefined);
        this.worker.logger.info({ workflowRunId: run.id }, DomainEventName.WORKFLOW_COMPLETED);
        return {
          workflowRunId,
          decision: 'COMPLETE',
          status: RunStatus.SUCCEEDED,
          reason: decision.reason,
          shouldContinue: false,
        };

      case 'FAIL':
        if (!(await this.transitions.finishWorkflow(
          run.id, task.id, RunStatus.FAILED, TaskStatus.FAILED, decision.reason, traceId,
        ))) {
          return this.staleResult(run.id);
        }
        return {
          workflowRunId,
          decision: 'FAIL',
          status: RunStatus.FAILED,
          reason: decision.reason,
          shouldContinue: false,
        };

      case 'WAIT_FOR_HUMAN':
        if (!(await this.transitions.finishWorkflow(
          run.id, task.id, RunStatus.WAITING_FOR_HUMAN,
          TaskStatus.NEEDS_HUMAN_REVIEW, decision.reason, traceId,
        ))) {
          return this.staleResult(run.id);
        }
        await this.requestApproval(task.id, task.projectId, decision.reason);
        return {
          workflowRunId,
          decision: 'WAIT_FOR_HUMAN',
          status: RunStatus.WAITING_FOR_HUMAN,
          reason: decision.reason,
          shouldContinue: false,
        };

      case 'CANCELLED':
        if (!(await this.finishRun(run.id, RunStatus.CANCELLED, decision.reason))) {
          return this.staleResult(run.id);
        }
        return {
          workflowRunId,
          decision: 'CANCELLED',
          status: RunStatus.CANCELLED,
          reason: decision.reason,
          shouldContinue: false,
        };

      case 'RUN_STEP':
        return this.executeStep({ run: claimedRun, task, state, decision, traceId });
    }
  }

  private async executeStep(input: {
    run: LoadedRun;
    task: StepExecutionContext['task'];
    state: PersistedWorkflowState;
    decision: Extract<WorkflowDecision, { type: 'RUN_STEP' }>;
    traceId: string;
  }): Promise<AdvanceResult> {
    const { prisma, logger } = this.worker;
    const { run, task, state, decision, traceId } = input;
    const definitionStep = decision.step;

    const currentStepKey = run.currentStepKey ?? null;
    const abandonedStep = currentStepKey === definitionStep.key
      ? [...run.steps].reverse().find(
          (row) => row.stepKey === definitionStep.key && row.status === RunStatus.RUNNING,
        )
      : undefined;
    if (currentStepKey !== null) {
      const leaseAge = Date.now() - run.updatedAt.getTime();
      if (!abandonedStep || leaseAge < STEP_LEASE_MS) return this.staleResult(run.id);
    }

    // Cycle steps get a fresh row each cycle. A one-shot retry, or a step whose
    // worker died after claiming it, reuses the observed row with a new attempt
    // token so the old execution can no longer heartbeat or persist a result.
    const reusable = abandonedStep ?? (
      !CYCLE_STEPS.includes(definitionStep.key)
        ? run.steps.find(
            (row) => row.stepKey === definitionStep.key && row.status !== RunStatus.SUCCEEDED,
          )
        : undefined
    );

    const staleClaim = new Error('STALE_WORKFLOW_STEP_CLAIM');
    let step: WorkflowStep | null;
    try {
      step = await prisma.$transaction(async (tx) => {
        const lockedTask = await tx.$queryRaw<Array<{ status: TaskStatus }>>`
          SELECT status FROM tasks WHERE id = ${task.id} FOR UPDATE
        `;
        if (lockedTask[0]?.status === TaskStatus.CANCELLED) throw staleClaim;
        const claimed = await tx.workflowRun.updateMany({
          where: {
            id: run.id,
            status: RunStatus.RUNNING,
            currentStepKey,
            updatedAt: run.updatedAt,
          },
          data: { currentStepKey: definitionStep.key, updatedAt: new Date() },
        });
        if (claimed.count !== 1) throw staleClaim;

        if (!reusable) {
          return tx.workflowStep.create({
            data: {
              workflowRunId: run.id,
              stepKey: definitionStep.key,
              sequence: run.steps.length,
              status: RunStatus.RUNNING,
              attempt: 1,
              maxAttempts: definitionStep.maxAttempts,
              startedAt: new Date(),
              input: { reason: decision.reason } as Prisma.InputJsonValue,
            },
          });
        }

        const stepClaimed = await tx.workflowStep.updateMany({
          where: { id: reusable.id, status: reusable.status, attempt: reusable.attempt },
          data: {
            status: RunStatus.RUNNING,
            attempt: reusable.attempt + 1,
            startedAt: new Date(),
            error: null,
          },
        });
        if (stepClaimed.count !== 1) throw staleClaim;
        return tx.workflowStep.findUniqueOrThrow({ where: { id: reusable.id } });
      });
    } catch (error) {
      if (error === staleClaim) return this.staleResult(run.id);
      throw error;
    }
    if (!step) return this.staleResult(run.id);

    try {
      if (definitionStep.entryStatus) {
        await this.transitions.to(task.id, definitionStep.entryStatus, { traceId });
      }
    } catch (error) {
      await this.releaseStepClaim(run.id, definitionStep.key, step, String(error));
      throw error;
    }

    const handler = STEP_HANDLERS[definitionStep.key];
    const startedAt = Date.now();
    let outcome: StepOutcome;

    let heartbeat: Promise<void> | null = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeat) return;
      heartbeat = this.heartbeatStepClaim(run.id, definitionStep.key, step)
        .catch((error) => {
          logger.withContext({ traceId, workflowRunId: run.id }).warn(
            { error: String(error), step: definitionStep.key },
            'workflow.step.heartbeat_failed',
          );
        })
        .finally(() => { heartbeat = null; });
    }, STEP_HEARTBEAT_MS);
    try {
      if (!handler) {
        outcome = { status: RunStatus.FAILED, error: `No handler for step ${definitionStep.key}` };
      } else {
        try {
          outcome = await handler({
            worker: this.worker,
            transitions: this.transitions,
            run,
            step,
            definition: definitionStep,
            task,
            state,
            traceId,
            logger: logger.withContext({ traceId, workflowRunId: run.id, taskId: task.id }),
          });
        } catch (error) {
          outcome = {
            status: RunStatus.FAILED,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    } finally {
      clearInterval(heartbeatTimer);
      if (heartbeat) await heartbeat;
    }

    const durationMs = Date.now() - startedAt;
    const retriable =
      outcome.status === RunStatus.FAILED && step.attempt < definitionStep.maxAttempts;

    const nextState: PersistedWorkflowState = { ...state, ...outcome.patch };
    const stalePersistence = new Error('STALE_WORKFLOW_STEP_RESULT');
    let persisted = false;
    try {
      persisted = await prisma.$transaction(async (tx) => {
        const lockedTask = await tx.$queryRaw<Array<{ status: TaskStatus }>>`
          SELECT status FROM tasks WHERE id = ${task.id} FOR UPDATE
        `;
        if (lockedTask[0]?.status === TaskStatus.CANCELLED) throw stalePersistence;
        const claimed = await tx.workflowRun.updateMany({
          where: {
            id: run.id,
            status: RunStatus.RUNNING,
            currentStepKey: definitionStep.key,
            steps: {
              some: {
                id: step.id,
                status: RunStatus.RUNNING,
                attempt: step.attempt,
                startedAt: step.startedAt,
              },
            },
          },
          data: {
            state: nextState as unknown as Prisma.InputJsonValue,
            reviewCycle: nextState.reviewCycle,
            attempt: nextState.attempt,
            currentStepKey: null,
          },
        });
        if (claimed.count !== 1) throw stalePersistence;
        const stepPersisted = await tx.workflowStep.updateMany({
          where: {
            id: step.id,
            status: RunStatus.RUNNING,
            attempt: step.attempt,
            startedAt: step.startedAt,
          },
          data: {
            // A retriable failure goes back to PENDING so the router offers the step
            // again; only an exhausted step is recorded as FAILED.
            status: retriable ? RunStatus.PENDING : outcome.status,
            output: (outcome.output ?? null) as Prisma.InputJsonValue,
            error: outcome.error ?? null,
            finishedAt: new Date(),
            durationMs,
          },
        });
        if (stepPersisted.count !== 1) throw stalePersistence;
        return true;
      });
    } catch (error) {
      if (error !== stalePersistence) {
        await this.releaseStepClaim(run.id, definitionStep.key, step, String(error));
        throw error;
      }
    }
    if (!persisted) return this.staleResult(run.id);

    logger.withContext({ traceId, workflowRunId: run.id }).info(
      {
        step: definitionStep.key,
        status: outcome.status,
        durationMs,
        attempt: step.attempt,
        retriable,
      },
      'workflow.step.completed',
    );

    return {
      workflowRunId: run.id,
      decision: 'RUN_STEP',
      stepKey: definitionStep.key,
      status: outcome.status,
      reason: outcome.error ?? decision.reason,
      shouldContinue: true,
    };
  }

  private async heartbeatStepClaim(
    workflowRunId: string,
    stepKey: WorkflowStepKey,
    step: WorkflowStep,
  ): Promise<void> {
    await this.worker.prisma.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: RunStatus.RUNNING,
        currentStepKey: stepKey,
        steps: {
          some: {
            id: step.id,
            status: RunStatus.RUNNING,
            attempt: step.attempt,
            startedAt: step.startedAt,
          },
        },
      },
      data: { updatedAt: new Date() },
    });
  }

  private async releaseStepClaim(
    workflowRunId: string,
    stepKey: WorkflowStepKey,
    step: WorkflowStep,
    reason: string,
  ): Promise<void> {
    const staleRelease = new Error('STALE_WORKFLOW_STEP_RELEASE');
    try {
      await this.worker.prisma.$transaction(async (tx) => {
        const runReleased = await tx.workflowRun.updateMany({
          where: {
            id: workflowRunId,
            status: RunStatus.RUNNING,
            currentStepKey: stepKey,
            steps: {
              some: {
                id: step.id,
                status: RunStatus.RUNNING,
                attempt: step.attempt,
                startedAt: step.startedAt,
              },
            },
          },
          data: { currentStepKey: null },
        });
        if (runReleased.count !== 1) throw staleRelease;
        const stepReleased = await tx.workflowStep.updateMany({
          where: {
            id: step.id,
            status: RunStatus.RUNNING,
            attempt: step.attempt,
            startedAt: step.startedAt,
          },
          data: { status: RunStatus.PENDING, error: reason, finishedAt: new Date() },
        });
        if (stepReleased.count !== 1) throw staleRelease;
      });
    } catch (error) {
      if (error !== staleRelease) throw error;
    }
  }

  private async finishRun(id: string, status: RunStatus, reason: string): Promise<boolean> {
    const claimed = await this.worker.prisma.workflowRun.updateMany({
      where: { id, status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] } },
      data: {
        status,
        error: status === RunStatus.SUCCEEDED ? null : reason,
        completedAt: new Date(),
        currentStepKey: null,
      },
    });
    return claimed.count === 1;
  }

  private async staleResult(id: string): Promise<AdvanceResult> {
    const current = await this.worker.prisma.workflowRun.findUnique({
      where: { id },
      select: { status: true },
    });
    const status = current?.status ?? RunStatus.CANCELLED;
    return {
      workflowRunId: id,
      decision: status === RunStatus.CANCELLED ? 'CANCELLED' : 'COMPLETE',
      status,
      reason: `Workflow run changed to ${status}`,
      shouldContinue: false,
    };
  }

  private async requestApproval(taskId: string, projectId: string, reason: string): Promise<void> {
    const existing = await this.worker.prisma.approval.findFirst({
      where: { taskId, status: 'PENDING' },
    });
    if (existing) return;

    await this.worker.prisma.approval.create({
      data: { projectId, taskId, kind: 'IMPLEMENTATION', status: 'PENDING', reason },
    });
  }

  async cancel(workflowRunId: string, reason: string): Promise<void> {
    const run = await this.worker.prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: { task: { select: { projectId: true } } },
    });
    if (!run) return;

    if (run.taskId && (!run.task || run.task.projectId !== run.projectId)) {
      throw new Error('Workflow run task does not belong to its project');
    }

    if (run.status === RunStatus.CANCELLED) {
      await this.cancelRunningSteps(workflowRunId, reason);
      return;
    }
    if (
      run.status !== RunStatus.PENDING &&
      run.status !== RunStatus.RUNNING &&
      run.status !== RunStatus.WAITING_FOR_HUMAN
    ) return;

    const claimed = await this.worker.prisma.workflowRun.updateMany({
      where: {
        id: workflowRunId,
        status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING_FOR_HUMAN] },
      },
      data: {
        status: RunStatus.CANCELLED,
        error: reason,
        completedAt: new Date(),
        state: { ...((run.state ?? {}) as object), cancelled: true } as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) return;

    await this.cancelRunningSteps(workflowRunId, reason);

    if (run.taskId) {
      await this.transitions.to(run.taskId, TaskStatus.CANCELLED, { reason });
    }
  }

  private async cancelRunningSteps(workflowRunId: string, reason: string): Promise<void> {
    await this.worker.prisma.workflowStep.updateMany({
      where: { workflowRunId, status: RunStatus.RUNNING },
      data: { status: RunStatus.CANCELLED, error: reason, finishedAt: new Date() },
    });
  }
}
