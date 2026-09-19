import { AgentRole, AgentRunStatus, RunStatus } from '@engloop/types';
import { parseSafely, uiReviewOutputSchema } from '@engloop/schemas';
import type { StepHandler } from './types';

/**
 * UI_QA — screenshots are reviewed for layout, responsive and accessibility
 * defects (roadmap item 4).
 *
 * Runs once, after the deterministic checks are green and before code review, so
 * its findings reach the reviewer as context rather than as a competing verdict.
 *
 * Screenshot capture is not implemented yet: this step wires the path from the
 * workflow to `ReviewEngine.persistUi`, which had no caller at all before it.
 * Task 02 replaces the empty capture set below with real Playwright output
 * without changing this seam.
 *
 * The step is `optional` in the workflow definition, so every failure here
 * degrades the run rather than failing a task whose code is sound.
 */
export const uiQaStep: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step, logger } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  if (!workspacePath) {
    return { status: RunStatus.SKIPPED, output: { reason: 'No worktree to review' } };
  }

  // Screenshots are captured in task 02. Until then the reviewer is handed an
  // empty set, which is honest input rather than invented evidence — a UI review
  // with nothing to look at is a skip, not an approval.
  const screenshots = await worker.prisma.screenshot.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
  });

  if (screenshots.length === 0) {
    logger.info({ taskId: task.id }, 'ui_qa.skipped_no_screenshots');
    return {
      status: RunStatus.SKIPPED,
      output: { reason: 'No screenshots captured for this task' },
    };
  }

  const reviewRun = await worker.prisma.reviewRun.create({
    data: {
      taskId: task.id,
      workflowRunId: run.id,
      workflowStepId: step.id,
      kind: 'UI',
      status: RunStatus.RUNNING,
      cycle: state.reviewCycle + 1,
      startedAt: new Date(),
    },
  });

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.UI_REVIEWER,
    input: {
      taskId: task.id,
      pages: [...new Set(screenshots.map((shot) => shot.page))],
      screenshots: screenshots.map((shot) => ({
        id: shot.id,
        page: shot.page,
        viewport: shot.viewport,
        width: shot.width,
        height: shot.height,
        storagePath: shot.storagePath,
      })),
      consoleErrors: screenshots.flatMap((shot) => shot.consoleErrors),
      failedRequests: screenshots.flatMap((shot) => shot.failedRequests),
    },
    workspacePath,
    branchName: state.branchName,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    await worker.prisma.reviewRun.update({
      where: { id: reviewRun.id },
      data: { status: RunStatus.FAILED, completedAt: new Date() },
    });
    return { status: RunStatus.FAILED, error: outcome.error ?? 'UI review failed' };
  }

  const parsed = parseSafely(uiReviewOutputSchema, outcome.output, 'ui review output');
  if (!parsed.ok) {
    await worker.prisma.reviewRun.update({
      where: { id: reviewRun.id },
      data: { status: RunStatus.FAILED, completedAt: new Date() },
    });
    return { status: RunStatus.FAILED, error: parsed.error.message };
  }

  // A screenshot id is model output, so it is untrusted: a finding may only
  // point at a screenshot captured for *this* task. Anything else is dropped to
  // null rather than stored as a dangling reference.
  const ownedScreenshotIds = new Set(screenshots.map((shot) => shot.id));
  const findings = parsed.data.findings.map((finding) =>
    finding.screenshotId !== null && !ownedScreenshotIds.has(finding.screenshotId)
      ? { ...finding, screenshotId: null }
      : finding,
  );

  const persisted = await worker.reviews.persistUi({
    reviewRunId: reviewRun.id,
    taskId: task.id,
    agentRunId: outcome.agentRunId,
    output: { ...parsed.data, findings },
  });

  return {
    status: RunStatus.SUCCEEDED,
    output: {
      reviewRunId: reviewRun.id,
      decision: persisted.decision,
      findings: persisted.findingCount,
      blocking: persisted.blockingCount,
      screenshots: screenshots.length,
    },
    patch: {
      // Only a blocking UI finding re-opens the bounded fix loop. A UI reviewer
      // that declines without a critical or high finding must not send the work
      // back forever — the code reviewer still has to approve regardless, and
      // that branch is already bounded by maxReviewCycles.
      ...(persisted.blockingCount > 0 ? { hasBlockingFindings: true } : {}),
      lastReviewRunId: reviewRun.id,
    },
  };
};
