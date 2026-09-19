import {
  ArtifactKind,
  AuditAction,
  PullRequestStatus,
  RepositoryProvider,
  WorktreeStatus,
  type CommandResult,
} from '@engloop/types';
import { MAX_DIFF_BYTES, type Env } from '@engloop/config';
import type { EngLoopLogger } from '@engloop/logger';
import type { GitService, WorktreeManager } from '@engloop/git';
import type { GitHubAppClient, GitHubPullRequest } from '@engloop/github';
import type { PrismaClient } from '@engloop/db';
import type { AuditWriter } from './audit-writer';

export interface ProvisionWorktreeInput {
  taskId: string;
  traceId: string;
}

export interface ProvisionWorktreeOutcome {
  worktreeId: string;
  path: string;
  branch: string;
  baseRef: string;
  checkoutPath: string;
}

interface GitManagerDeps {
  prisma: PrismaClient;
  git: GitService;
  worktrees: WorktreeManager;
  github?: GitHubAppClient;
  logger: EngLoopLogger;
  env: Env;
  audit: AuditWriter;
}

export class GitHubDeliveryError extends Error {
  readonly code = 'GITHUB_DELIVERY_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'GitHubDeliveryError';
  }
}

/**
 * Owns every git side effect (spec section 11).
 *
 * Agents receive only the worktree path. The primary checkout under
 * `workspace/repositories/` is never handed out, so an agent physically cannot
 * modify the shared clone.
 */
export class GitManager {
  constructor(private readonly deps: GitManagerDeps) {}

  async provisionWorktree(input: ProvisionWorktreeInput): Promise<ProvisionWorktreeOutcome> {
    const { prisma, worktrees, logger, env, audit } = this.deps;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: input.taskId },
      include: {
        repository: true,
        project: { select: { id: true, organizationId: true } },
      },
    });

    if (!task.repository) {
      throw new Error(`Task ${task.key} has no repository; cannot provision a worktree`);
    }

    const authentication = await this.githubAuthentication(task.repository);

    let checkoutPath: string;
    try {
      checkoutPath = await worktrees.ensureCheckout({
        repositoryId: task.repository.id,
        remoteUrl: task.repository.remoteUrl,
        localPath:
          task.repository.provider === RepositoryProvider.GITHUB
            ? null
            : task.repository.localPath,
        defaultBranch: task.repository.defaultBranch,
        authentication,
      });
    } finally {
      if (authentication) authentication.token = '';
    }

    const lease = await worktrees.acquire({
      repositoryId: task.repository.id,
      taskKey: task.key,
      taskTitle: task.title,
      baseBranch: task.repository.defaultBranch,
      branchPrefix: env.GIT_BRANCH_PREFIX,
      checkoutPath,
      reuse: true,
    });

    const worktree = await prisma.gitWorktree.upsert({
      where: { repositoryId_path: { repositoryId: task.repository.id, path: lease.path } },
      create: {
        repositoryId: task.repository.id,
        taskId: task.id,
        path: lease.path,
        branch: lease.branch,
        baseRef: lease.baseRef,
        status: WorktreeStatus.ACTIVE,
      },
      update: { status: WorktreeStatus.ACTIVE, taskId: task.id, branch: lease.branch },
    });

    await prisma.gitBranch.upsert({
      where: { repositoryId_name: { repositoryId: task.repository.id, name: lease.branch } },
      create: {
        repositoryId: task.repository.id,
        name: lease.branch,
        baseBranch: lease.baseRef,
      },
      update: {},
    });

    await prisma.task.update({
      where: { id: task.id },
      data: { branchName: lease.branch, worktreePath: lease.path },
    });

    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      action: AuditAction.GIT_ACTION,
      entityType: 'git_worktree',
      entityId: worktree.id,
      summary: `Created worktree ${lease.path} on ${lease.branch}`,
      metadata: { baseRef: lease.baseRef },
      traceId: input.traceId,
    });

    logger.info(
      { taskKey: task.key, path: lease.path, branch: lease.branch },
      'worktree.provisioned',
    );

    return {
      worktreeId: worktree.id,
      path: lease.path,
      branch: lease.branch,
      baseRef: lease.baseRef,
      checkoutPath,
    };
  }

  /** Captures the diff as an artifact so reviewers read a snapshot, not live disk. */
  async captureDiff(taskId: string, worktreePath: string, baseRef: string) {
    const { prisma, git } = this.deps;

    let diff = '';
    let changedFiles: { path: string; changeType: string; additions: number; deletions: number }[] =
      [];

    try {
      diff = await git.diff(worktreePath, baseRef);
      if (!diff.trim()) diff = await git.diffWorkingTree(worktreePath);
      changedFiles = await git.changedFiles(worktreePath, baseRef);
    } catch {
      diff = '';
      changedFiles = [];
    }

    const truncated = diff.length > MAX_DIFF_BYTES;
    const content = truncated ? `${diff.slice(0, MAX_DIFF_BYTES)}\n\n[... diff truncated]` : diff;

    const artifact = await prisma.artifact.create({
      data: {
        taskId,
        kind: ArtifactKind.DIFF,
        name: `diff-${new Date().toISOString()}.patch`,
        contentType: 'text/x-diff',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        content,
        metadata: { baseRef, truncated, fileCount: changedFiles.length },
      },
    });

    return { artifactId: artifact.id, diff: content, truncated, changedFiles };
  }

  async commitWork(taskId: string, worktreePath: string, message: string, traceId: string) {
    const { prisma, git, audit } = this.deps;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { repository: true, project: { select: { organizationId: true } } },
    });
    if (!task.repository) return null;

    let sha: string | null = null;
    try {
      sha = await git.commit(worktreePath, message);
    } catch {
      return null;
    }
    if (!sha) return null;

    const changes = await git.changedFiles(worktreePath, `${sha}~1`, sha).catch(() => []);
    const branch = task.branchName
      ? await prisma.gitBranch.findUnique({
          where: { repositoryId_name: { repositoryId: task.repository.id, name: task.branchName } },
        })
      : null;

    const commit = await prisma.commit.upsert({
      where: { repositoryId_sha: { repositoryId: task.repository.id, sha } },
      create: {
        repositoryId: task.repository.id,
        branchId: branch?.id ?? null,
        taskId,
        sha,
        message,
        authorName: this.deps.env.GIT_AUTHOR_NAME,
        authorEmail: this.deps.env.GIT_AUTHOR_EMAIL,
        filesChanged: changes.length,
        additions: changes.reduce((sum, change) => sum + change.additions, 0),
        deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
      },
      update: {},
    });

    if (branch) {
      await prisma.gitBranch.update({ where: { id: branch.id }, data: { headSha: sha } });
    }

    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId,
      action: AuditAction.GIT_ACTION,
      entityType: 'commit',
      entityId: commit.id,
      summary: `Committed ${sha.slice(0, 8)}: ${message.split('\n')[0] ?? ''}`,
      traceId,
    });

    return commit;
  }

  /** Opens a real provider PR, retaining placeholders only for LOCAL repositories. */
  async openPullRequest(taskId: string, traceId: string) {
    const { prisma, git, audit, logger } = this.deps;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        repository: true,
        project: { select: { organizationId: true } },
      },
    });
    if (!task.repository || !task.branchName) return null;

    const title = `${task.key}: ${task.title}`;
    const body = [
      task.objective || task.description,
      '',
      '### Acceptance criteria',
      ...task.acceptanceCriteria.map((criterion) => `- [x] ${criterion}`),
      '',
      `_Opened by EngLoop from branch \`${task.branchName}\`._`,
    ].join('\n');

    const branch = await prisma.gitBranch.findUnique({
      where: { repositoryId_name: { repositoryId: task.repository.id, name: task.branchName } },
    });

    if (task.repository.provider === RepositoryProvider.LOCAL) {
      const existing = await prisma.pullRequest.findFirst({
        where: { taskId, local: true },
      });
      if (existing) return existing;

      const pullRequest = await prisma.pullRequest.create({
        data: {
          repositoryId: task.repository.id,
          branchId: branch?.id ?? null,
          taskId,
          title,
          body,
          status: PullRequestStatus.OPEN,
          headBranch: task.branchName,
          baseBranch: task.repository.defaultBranch,
          local: true,
          url: null,
        },
      });

      await audit.record({
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId,
        action: AuditAction.GIT_ACTION,
        entityType: 'pull_request',
        entityId: pullRequest.id,
        summary: `Opened local pull request placeholder ${title}`,
        traceId,
      });
      return pullRequest;
    }

    if (task.repository.provider !== RepositoryProvider.GITHUB) {
      throw new GitHubDeliveryError(
        `Pull request delivery is not configured for provider ${task.repository.provider}`,
      );
    }

    // A repository may have been converted from legacy/local behavior. It must
    // never retain an OPEN placeholder that can be mistaken for GitHub delivery.
    await prisma.pullRequest.updateMany({
      where: {
        taskId,
        local: true,
        status: { in: [PullRequestStatus.DRAFT, PullRequestStatus.OPEN] },
      },
      data: { status: PullRequestStatus.CLOSED, closedAt: new Date() },
    });

    if (!task.worktreePath) {
      throw new GitHubDeliveryError('GitHub delivery requires a provisioned worktree');
    }
    if (!branch) {
      throw new GitHubDeliveryError('GitHub delivery requires a tracked branch');
    }

    const authentication = await this.githubAuthentication(task.repository);
    let result: CommandResult;
    try {
      result = await git.push(task.worktreePath, task.branchName, 'origin', authentication);
    } finally {
      if (authentication) authentication.token = '';
    }
    if (result.exitCode !== 0) {
      logger.warn(
        { taskKey: task.key, exitCode: result.exitCode },
        'github.branch_push.failed',
      );
      await audit.record({
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId,
        action: AuditAction.GIT_ACTION,
        entityType: 'git_branch',
        entityId: branch.id,
        summary: `Failed to push GitHub branch ${task.branchName}`,
        metadata: { exitCode: result.exitCode },
        traceId,
      });
      throw new GitHubDeliveryError('GitHub branch push failed');
    }

    await prisma.gitBranch.update({ where: { id: branch.id }, data: { pushed: true } });
    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId,
      action: AuditAction.GIT_ACTION,
      entityType: 'git_branch',
      entityId: branch.id,
      summary: `Pushed GitHub branch ${task.branchName}`,
      traceId,
    });

    const github = this.requireGitHubClient();
    let remotePullRequest: GitHubPullRequest;
    try {
      remotePullRequest = await github.createOrFindPullRequest({
        installationId: task.repository.installationId!,
        repositoryId: this.githubRepositoryId(task.repository),
        owner: task.repository.githubOwner!,
        repo: task.repository.name,
        head: `${task.repository.githubOwner}:${task.branchName}`,
        base: task.repository.defaultBranch,
        title,
        body,
        draft: false,
      });
    } catch {
      await audit.record({
        organizationId: task.project.organizationId,
        projectId: task.projectId,
        taskId,
        action: AuditAction.GIT_ACTION,
        entityType: 'pull_request',
        entityId: task.id,
        summary: `Failed to open GitHub pull request for ${task.branchName}`,
        traceId,
      });
      throw new GitHubDeliveryError('GitHub pull request creation failed');
    }

    const status = remotePullRequest.merged
      ? PullRequestStatus.MERGED
      : remotePullRequest.state === 'closed'
        ? PullRequestStatus.CLOSED
        : remotePullRequest.draft
          ? PullRequestStatus.DRAFT
          : PullRequestStatus.OPEN;

    const existingByNumber = await prisma.pullRequest.findUnique({
      where: {
        repositoryId_number: {
          repositoryId: task.repository.id,
          number: remotePullRequest.number,
        },
      },
    });
    const existingByTask = existingByNumber
      ? null
      : await prisma.pullRequest.findFirst({ where: { taskId } });
    const data = {
      branchId: branch.id,
      taskId,
      number: remotePullRequest.number,
      title: remotePullRequest.title,
      body: remotePullRequest.body,
      status,
      headBranch: remotePullRequest.head,
      baseBranch: remotePullRequest.base,
      draft: remotePullRequest.draft,
      local: false,
      url: remotePullRequest.htmlUrl,
    };

    const pullRequest = existingByNumber
      ? await prisma.pullRequest.update({ where: { id: existingByNumber.id }, data })
      : existingByTask
        ? await prisma.pullRequest.update({ where: { id: existingByTask.id }, data })
        : await prisma.pullRequest.create({
            data: { repositoryId: task.repository.id, ...data },
          });

    await audit.record({
      organizationId: task.project.organizationId,
      projectId: task.projectId,
      taskId,
      action: AuditAction.GIT_ACTION,
      entityType: 'pull_request',
      entityId: pullRequest.id,
      summary: `${remotePullRequest.created ? 'Opened' : 'Found'} GitHub pull request #${String(remotePullRequest.number)}`,
      traceId,
    });

    return pullRequest;
  }

  private requireGitHubClient(): GitHubAppClient {
    if (!this.deps.github) {
      throw new GitHubDeliveryError('GitHub App credentials are not configured in the worker');
    }
    return this.deps.github;
  }

  private githubRepositoryId(repository: {
    githubRepositoryId?: string | null;
  }): string {
    const repositoryId = repository.githubRepositoryId;
    const numericId = Number(repositoryId);
    if (!repositoryId || !Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new GitHubDeliveryError('GitHub repository identity is missing or invalid');
    }
    return repositoryId;
  }

  private async githubAuthentication(repository: {
    provider: string;
    installationId?: string | null;
    githubRepositoryId?: string | null;
    githubOwner?: string | null;
    remoteUrl?: string | null;
  }) {
    if (repository.provider !== RepositoryProvider.GITHUB) return undefined;
    if (!repository.installationId || !repository.githubOwner || !repository.remoteUrl) {
      throw new GitHubDeliveryError('GitHub repository configuration is incomplete');
    }
    let remote: URL;
    try {
      remote = new URL(repository.remoteUrl);
    } catch {
      throw new GitHubDeliveryError('GitHub remote URL must be canonical HTTPS');
    }
    if (remote.protocol !== 'https:' || remote.username || remote.password) {
      throw new GitHubDeliveryError('GitHub remote URL must be canonical HTTPS');
    }

    const repositoryId = this.githubRepositoryId(repository);
    const access = await this.requireGitHubClient().createInstallationAccessToken(
      repository.installationId,
      {
        repositoryIds: [repositoryId],
        permissions: { contents: 'write' },
      },
    );
    return { token: access.token };
  }

  async releaseWorktree(taskId: string): Promise<void> {
    const { prisma, worktrees } = this.deps;
    const worktree = await prisma.gitWorktree.findFirst({
      where: { taskId, status: WorktreeStatus.ACTIVE },
      include: { repository: true },
    });
    if (!worktree) return;

    const checkoutPath = worktrees.checkoutPath(worktree.repositoryId);
    await worktrees.release(checkoutPath, { path: worktree.path }).catch(() => undefined);
    await prisma.gitWorktree.update({
      where: { id: worktree.id },
      data: { status: WorktreeStatus.RELEASED, releasedAt: new Date() },
    });
  }

  /** Definition-of-done check: the worktree must have no uncommitted changes. */
  async isClean(worktreePath: string): Promise<boolean> {
    try {
      const status = await this.deps.git.status(worktreePath);
      return status.clean;
    } catch {
      return false;
    }
  }
}
