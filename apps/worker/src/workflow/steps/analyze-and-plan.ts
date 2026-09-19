import { AgentRole, AgentRunStatus, RunStatus } from '@engloop/types';
import { plannerOutputSchema, repositoryAnalysisOutputSchema, parseSafely } from '@engloop/schemas';
import type { StepHandler } from './types';

/**
 * ANALYZE_REPOSITORY — the planner inspects the repository.
 *
 * The worktree is provisioned here (idempotently) so that even read-only agent
 * steps operate on an isolated checkout; CREATE_WORKTREE later just records the
 * lease. This is stricter than the spec's ordering and keeps the invariant
 * "no agent ever touches workspace/repositories/" literally true.
 */
export const analyzeRepositoryStep: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step } = context;

  if (!task.repository) {
    return {
      status: RunStatus.SKIPPED,
      output: { skipped: 'Task has no repository attached' },
    };
  }

  const lease = await worker.gitManager.provisionWorktree({ taskId: task.id, traceId });

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.ARCHITECT,
    input: {
      requirement: state.requirement || task.description || task.title,
      targetPaths: state.targetPaths,
    },
    workspacePath: lease.path,
    branchName: lease.branch,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    return { status: RunStatus.FAILED, error: outcome.error ?? 'Repository analysis failed' };
  }

  const parsed = parseSafely(repositoryAnalysisOutputSchema, outcome.output, 'repository analysis');
  if (!parsed.ok) {
    return { status: RunStatus.FAILED, error: parsed.error.message };
  }

  await worker.prisma.repository.update({
    where: { id: task.repository.id },
    data: {
      primaryLanguage: parsed.data.primaryLanguage ?? task.repository.primaryLanguage,
      frameworks: parsed.data.frameworks.length > 0 ? parsed.data.frameworks : undefined,
      packageManager: parsed.data.packageManager ?? task.repository.packageManager,
      lastAnalyzedAt: new Date(),
      ...(Object.keys(parsed.data.testCommands).length > 0 &&
      Object.keys((task.repository.commands ?? {}) as object).length === 0
        ? { commands: parsed.data.testCommands }
        : {}),
    },
  });

  return {
    status: RunStatus.SUCCEEDED,
    output: parsed.data,
    patch: {
      worktreePath: lease.path,
      branchName: lease.branch,
      baseRef: lease.baseRef,
      checkoutPath: lease.checkoutPath,
    },
  };
};

/** PLAN — the planner produces an implementation plan and acceptance criteria. */
export const planStep: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  if (!workspacePath) {
    return { status: RunStatus.FAILED, error: 'No workspace available for planning' };
  }

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.PLANNER,
    input: {
      requirement: state.requirement || task.description || task.title,
      objective: task.objective,
      taskType: task.type,
      priority: task.priority,
      constraints: state.constraints,
      targetPaths: state.targetPaths,
    },
    workspacePath,
    branchName: state.branchName,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    return { status: RunStatus.FAILED, error: outcome.error ?? 'Planning failed' };
  }

  const parsed = parseSafely(plannerOutputSchema, outcome.output, 'planner output');
  if (!parsed.ok) return { status: RunStatus.FAILED, error: parsed.error.message };

  return {
    status: RunStatus.SUCCEEDED,
    output: parsed.data,
    patch: { plannerSummary: parsed.data.summary },
  };
};

/** CREATE_TASKS — the validated plan becomes real child tasks and dependencies. */
export const createTasksStep: StepHandler = async (context) => {
  const { worker, task, run } = context;

  const planStepRow = await worker.prisma.workflowStep.findFirst({
    where: { workflowRunId: run.id, stepKey: 'PLAN', status: RunStatus.SUCCEEDED },
    orderBy: { finishedAt: 'desc' },
  });

  const parsed = parseSafely(plannerOutputSchema, planStepRow?.output, 'stored plan');
  if (!parsed.ok) {
    return { status: RunStatus.FAILED, error: 'No valid plan is available to materialise' };
  }

  const { createdTaskIds } = await worker.plans.materialize(task.id, parsed.data);

  return {
    status: RunStatus.SUCCEEDED,
    output: { createdTaskIds, count: createdTaskIds.length },
    patch: { createdChildTaskIds: createdTaskIds },
  };
};
