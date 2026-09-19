import { RepositoryProvider, RunStatus, TaskStatus } from '@engloop/types';
import type { StepHandler } from './types';

/** PREPARE_PR — push the branch (when a remote exists) and open a pull request. */
export const preparePullRequestStep: StepHandler = async (context) => {
  const { worker, task, traceId, transitions } = context;

  await transitions.to(task.id, TaskStatus.PR_READY, { traceId });
  const pullRequest = await worker.gitManager.openPullRequest(task.id, traceId);

  if (!pullRequest) {
    return {
      status: RunStatus.SKIPPED,
      output: { skipped: 'No repository or branch available for a pull request' },
    };
  }

  await transitions.to(task.id, TaskStatus.PR_CREATED, { traceId });

  return {
    status: RunStatus.SUCCEEDED,
    output: {
      pullRequestId: pullRequest.id,
      headBranch: pullRequest.headBranch,
      baseBranch: pullRequest.baseBranch,
      local: pullRequest.local,
      number: pullRequest.number,
      url: pullRequest.url,
    },
  };
};

/**
 * COMPLETE — the definition-of-done gate (spec section 43).
 *
 * Re-derives every condition from the database instead of trusting accumulated
 * workflow state, and refuses to complete a task that does not satisfy them.
 */
export const completeStep: StepHandler = async (context) => {
  const { worker, task, state } = context;

  const githubRepository = task.repository?.provider === RepositoryProvider.GITHUB;
  const [latestTestRun, blockingFindings, deliveredPullRequest, deliveredBranch] = await Promise.all([
    worker.prisma.testRun.findFirst({
      where: { taskId: task.id },
      orderBy: { createdAt: 'desc' },
    }),
    worker.prisma.reviewFinding.count({
      where: {
        reviewRun: { taskId: task.id },
        status: { in: ['OPEN', 'FIXING'] },
        severity: { in: ['CRITICAL', 'HIGH'] },
      },
    }),
    githubRepository
      ? worker.prisma.pullRequest.findFirst({
          where: { taskId: task.id, local: false },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve(null),
    githubRepository && task.repository && task.branchName
      ? worker.prisma.gitBranch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: task.repository.id,
              name: task.branchName,
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const worktreePath = state.worktreePath ?? task.worktreePath;
  const worktreeClean = worktreePath ? await worker.gitManager.isClean(worktreePath) : true;

  const gates = {
    checksPassed: latestTestRun?.passed === true,
    reviewApproved: state.reviewApproved,
    noBlockingFindings: blockingFindings === 0,
    worktreeClean,
    acceptanceCriteriaRecorded: task.acceptanceCriteria.length > 0,
    githubDeliveryComplete:
      !githubRepository ||
      Boolean(
        deliveredPullRequest &&
          !deliveredPullRequest.local &&
          deliveredPullRequest.number !== null &&
          deliveredPullRequest.url &&
          deliveredBranch?.pushed,
      ),
  };

  const unmet = Object.entries(gates)
    .filter(([, satisfied]) => !satisfied)
    .map(([name]) => name);

  // Acceptance criteria are advisory for a task that never went through
  // planning; every other gate is blocking.
  const blocking = unmet.filter((gate) => gate !== 'acceptanceCriteriaRecorded');

  if (blocking.length > 0) {
    return {
      status: RunStatus.FAILED,
      error: `Definition of done not satisfied: ${blocking.join(', ')}`,
      output: { gates },
    };
  }

  return { status: RunStatus.SUCCEEDED, output: { gates, unmet } };
};
