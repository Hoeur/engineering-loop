import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { silentLogger, type EngLoopLogger } from '@engloop/logger';
import type { GitHttpAuthentication, GitService } from './git-service';
import {
  buildBranchName,
  buildWorkspaceLayout,
  repositoryCheckoutPath,
  worktreePath,
  type WorkspaceLayout,
} from './paths';

const normalizeFilesystemPath = (value: string): string => {
  const unified = resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
};

/**
 * Compares filesystem paths the way the OS does. `git worktree list` prints
 * forward slashes on Windows while Node builds backslash paths, and Windows paths
 * are case-insensitive — a plain `===` never matches there.
 */
export const sameFilesystemPath = (a: string, b: string): boolean =>
  normalizeFilesystemPath(a) === normalizeFilesystemPath(b);

const directoryExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const isInsideDirectory = (parent: string, child: string): boolean =>
  normalizeFilesystemPath(child).startsWith(`${normalizeFilesystemPath(parent)}/`);

export interface WorktreeLease {
  taskKey: string;
  repositoryId: string;
  path: string;
  branch: string;
  baseRef: string;
  createdAt: string;
}

export interface AcquireWorktreeInput {
  repositoryId: string;
  taskKey: string;
  taskTitle: string;
  baseBranch: string;
  branchPrefix?: string;
  /** Reuse an existing lease instead of failing — used when retrying a task. */
  reuse?: boolean;
}

export interface WorktreeManagerOptions {
  workspaceRoot: string;
  git: GitService;
  logger?: EngLoopLogger;
}

/**
 * Owns the `workspace/worktrees/<TASK-KEY>` isolation boundary (spec section 11).
 *
 * Agents never touch `workspace/repositories/<id>` — that checkout exists only so
 * git has an object store to create worktrees from.
 */
export class WorktreeManager {
  readonly layout: WorkspaceLayout;
  private readonly logger: EngLoopLogger;

  constructor(private readonly options: WorktreeManagerOptions) {
    this.layout = buildWorkspaceLayout(options.workspaceRoot);
    this.logger = options.logger ?? silentLogger;
  }

  async ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(this.layout.repositories, { recursive: true }),
      mkdir(this.layout.worktrees, { recursive: true }),
      mkdir(this.layout.artifacts, { recursive: true }),
    ]);
  }

  checkoutPath(repositoryId: string): string {
    return repositoryCheckoutPath(this.layout, repositoryId);
  }

  /** Makes sure the primary checkout exists; clones or initialises it if not. */
  async ensureCheckout(input: {
    repositoryId: string;
    remoteUrl?: string | null;
    localPath?: string | null;
    defaultBranch: string;
    authentication?: GitHttpAuthentication;
  }): Promise<string> {
    await this.ensureLayout();

    if (input.localPath && (await this.options.git.isRepository(input.localPath))) {
      return input.localPath;
    }

    const path = this.checkoutPath(input.repositoryId);
    if (await this.options.git.isRepository(path)) {
      if (input.remoteUrl) {
        await this.options.git.setRemoteUrl(path, input.remoteUrl);
        await this.options.git.fetch(path, 'origin', input.authentication);
      }
      return path;
    }

    if (input.remoteUrl) {
      await this.options.git.clone(
        input.remoteUrl,
        path,
        input.defaultBranch,
        input.authentication,
      );
    } else {
      await this.options.git.init(path, input.defaultBranch);
    }
    return path;
  }

  async acquire(input: AcquireWorktreeInput & { checkoutPath: string }): Promise<WorktreeLease> {
    await this.ensureLayout();

    const path = worktreePath(this.layout, input.taskKey);
    const branch = buildBranchName(input.taskKey, input.taskTitle, input.branchPrefix ?? 'agent');

    const existing = await this.options.git.listWorktrees(input.checkoutPath);
    const match = existing.find((entry) => sameFilesystemPath(entry.path, path));

    // Git keeps listing a worktree whose folder was deleted, so a registration alone
    // proves nothing: reuse only a worktree that is still on disk.
    if (match && input.reuse && match.branch === branch && (await directoryExists(path))) {
      // Idempotent re-acquire: a retried step must not wipe work in progress.
      this.logger.debug({ path, branch }, 'worktree.reused');
      return {
        taskKey: input.taskKey,
        repositoryId: input.repositoryId,
        path,
        branch,
        baseRef: input.baseBranch,
        createdAt: new Date().toISOString(),
      };
    }

    if (match) this.logger.warn({ path, branch }, 'worktree.recycling_existing');
    // Always clear through git, not just the directory: a registration whose folder
    // is gone (a failed attempt, a crashed worker) makes `git worktree add` refuse
    // with "missing but already registered worktree" until it is pruned.
    await this.options.git.removeWorktree(input.checkoutPath, path);
    await rm(path, { recursive: true, force: true });

    await this.options.git.addWorktree(input.checkoutPath, path, branch, input.baseBranch);

    return {
      taskKey: input.taskKey,
      repositoryId: input.repositoryId,
      path,
      branch,
      baseRef: input.baseBranch,
      createdAt: new Date().toISOString(),
    };
  }

  async release(checkoutPath: string, lease: Pick<WorktreeLease, 'path'>): Promise<void> {
    await this.options.git.removeWorktree(checkoutPath, lease.path);
  }

  /** Removes orphaned worktrees left behind by a crashed worker. */
  async prune(checkoutPath: string, activePaths: readonly string[]): Promise<string[]> {
    const entries = await this.options.git.listWorktrees(checkoutPath);
    const removed: string[] = [];
    for (const entry of entries) {
      if (sameFilesystemPath(entry.path, checkoutPath)) continue;
      if (!isInsideDirectory(this.layout.worktrees, entry.path)) continue;
      if (activePaths.some((active) => sameFilesystemPath(active, entry.path))) continue;
      await this.options.git.removeWorktree(checkoutPath, entry.path);
      removed.push(entry.path);
    }
    if (removed.length > 0) this.logger.info({ removed }, 'worktree.pruned');
    return removed;
  }
}
