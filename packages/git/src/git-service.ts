import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CommandResult } from '@engloop/types';
import { silentLogger, type EngLoopLogger } from '@engloop/logger';
import type { CommandRunner } from './command-runner';
import { GitOperationError } from './errors';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitServiceOptions {
  runner: CommandRunner;
  identity: GitIdentity;
  logger?: EngLoopLogger;
  /** Per-git-command timeout; clones get 4x this. */
  timeoutMs?: number;
}

export interface FileChange {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/** Ephemeral HTTP auth for one git process. The token is never placed in argv. */
export interface GitHttpAuthentication {
  token: string;
}

const gitAuthenticationEnv = (authentication: GitHttpAuthentication): Record<string, string> => {
  if (!authentication.token) {
    throw new Error('Git authentication token must not be empty');
  }
  const credentials = Buffer.from(`x-access-token:${authentication.token}`, 'utf8').toString(
    'base64',
  );
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credentials}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  };
};

const redactAuthentication = (
  value: string,
  authentication?: GitHttpAuthentication,
): string => {
  if (!authentication) return value;
  const credentials = Buffer.from(`x-access-token:${authentication.token}`, 'utf8').toString(
    'base64',
  );
  return value
    .split(authentication.token)
    .join('[REDACTED]')
    .split(credentials)
    .join('[REDACTED]');
};

const assertCredentialFreeRemoteUrl = (remoteUrl: string): void => {
  if (!/^https?:\/\//i.test(remoteUrl)) return;
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new GitOperationError('remote validation', 'Remote URL is invalid');
  }
  if (parsed.username || parsed.password) {
    throw new GitOperationError(
      'remote validation',
      'Credential-bearing remote URLs are forbidden',
    );
  }
};

/**
 * Thin, testable wrapper over the git CLI (spec section 11).
 *
 * Everything goes through the allowlisted CommandRunner — no shell strings, no
 * interpolation of user or agent input into a command line.
 */
export class GitService {
  private readonly logger: EngLoopLogger;
  private readonly timeoutMs: number;

  constructor(private readonly options: GitServiceOptions) {
    this.logger = options.logger ?? silentLogger;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async git(
    cwd: string,
    args: string[],
    opts: {
      timeoutMs?: number;
      allowFailure?: boolean;
      operation?: string;
      authentication?: GitHttpAuthentication;
    } = {},
  ): Promise<CommandResult> {
    const authenticationEnv = opts.authentication
      ? gitAuthenticationEnv(opts.authentication)
      : undefined;
    let rawResult: CommandResult;
    try {
      rawResult = await this.options.runner.run({
        command: 'git',
        args: [
          '-c',
          `user.name=${this.options.identity.name}`,
          '-c',
          `user.email=${this.options.identity.email}`,
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'advice.detachedHead=false',
          ...args,
        ],
        cwd,
        timeoutMs: opts.timeoutMs ?? this.timeoutMs,
        label: `git ${args[0] ?? ''}`,
        env: authenticationEnv,
      });
    } finally {
      if (authenticationEnv) {
        for (const key of Object.keys(authenticationEnv)) authenticationEnv[key] = '';
      }
    }

    const result: CommandResult = {
      ...rawResult,
      stdout: redactAuthentication(rawResult.stdout, opts.authentication),
      stderr: redactAuthentication(rawResult.stderr, opts.authentication),
    };

    if (result.exitCode !== 0 && !opts.allowFailure) {
      throw new GitOperationError(
        opts.operation ?? args[0] ?? 'command',
        result.stderr.trim() || `exit code ${String(result.exitCode)}`,
        result.stderr,
      );
    }
    return result;
  }

  async isRepository(path: string): Promise<boolean> {
    try {
      await stat(path);
    } catch {
      return false;
    }
    const result = await this.git(path, ['rev-parse', '--is-inside-work-tree'], {
      allowFailure: true,
    });
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  }

  async init(path: string, defaultBranch = 'main'): Promise<void> {
    await mkdir(path, { recursive: true });
    await this.git(path, ['init', '--initial-branch', defaultBranch], { operation: 'init' });
  }

  async clone(
    remoteUrl: string,
    targetPath: string,
    branch?: string,
    authentication?: GitHttpAuthentication,
  ): Promise<void> {
    assertCredentialFreeRemoteUrl(remoteUrl);
    await mkdir(dirname(targetPath), { recursive: true });
    const args = ['clone', '--no-tags'];
    if (branch) args.push('--branch', branch);
    args.push('--', remoteUrl, targetPath);
    await this.git(dirname(targetPath), args, {
      timeoutMs: this.timeoutMs * 4,
      operation: 'clone',
      authentication,
    });
    this.logger.info({ remoteUrl, targetPath, branch }, 'git.clone.completed');
  }

  async fetch(
    repoPath: string,
    remote = 'origin',
    authentication?: GitHttpAuthentication,
  ): Promise<void> {
    await this.git(repoPath, ['fetch', '--prune', remote], {
      timeoutMs: this.timeoutMs * 2,
      operation: 'fetch',
      authentication,
    });
  }

  async setRemoteUrl(repoPath: string, remoteUrl: string, remote = 'origin'): Promise<void> {
    assertCredentialFreeRemoteUrl(remoteUrl);
    await this.git(repoPath, ['remote', 'set-url', remote, remoteUrl], {
      operation: 'remote set-url',
    });
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.git(repoPath, ['checkout', ref], { operation: 'checkout' });
  }

  async createBranch(repoPath: string, branch: string, baseRef: string): Promise<void> {
    await this.git(repoPath, ['branch', '--force', branch, baseRef], { operation: 'branch' });
  }

  async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const result = await this.git(
      repoPath,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      { allowFailure: true },
    );
    return result.exitCode === 0;
  }

  async currentBranch(repoPath: string): Promise<string> {
    const result = await this.git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.stdout.trim();
  }

  async headSha(repoPath: string): Promise<string> {
    const result = await this.git(repoPath, ['rev-parse', 'HEAD']);
    return result.stdout.trim();
  }

  async addWorktree(
    repoPath: string,
    worktreeDir: string,
    branch: string,
    baseRef: string,
  ): Promise<void> {
    await mkdir(dirname(worktreeDir), { recursive: true });
    const exists = await this.branchExists(repoPath, branch);
    const args = exists
      ? ['worktree', 'add', worktreeDir, branch]
      : ['worktree', 'add', '-b', branch, worktreeDir, baseRef];
    await this.git(repoPath, args, { operation: 'worktree add' });
    this.logger.info({ repoPath, worktreeDir, branch, baseRef }, 'git.worktree.created');
  }

  async removeWorktree(repoPath: string, worktreeDir: string, force = true): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreeDir);
    await this.git(repoPath, args, { allowFailure: true, operation: 'worktree remove' });
    await rm(worktreeDir, { recursive: true, force: true });
    await this.git(repoPath, ['worktree', 'prune'], { allowFailure: true });
    this.logger.info({ repoPath, worktreeDir }, 'git.worktree.removed');
  }

  async listWorktrees(repoPath: string): Promise<{ path: string; branch: string | null }[]> {
    const result = await this.git(repoPath, ['worktree', 'list', '--porcelain'], {
      allowFailure: true,
    });
    const entries: { path: string; branch: string | null }[] = [];
    let current: { path: string; branch: string | null } | null = null;
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current);
        current = { path: line.slice('worktree '.length).trim(), branch: null };
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).trim().replace('refs/heads/', '');
      }
    }
    if (current) entries.push(current);
    return entries;
  }

  async status(repoPath: string): Promise<GitStatus> {
    const [branch, porcelain] = await Promise.all([
      this.currentBranch(repoPath),
      // `--untracked-files=all`: without it git collapses a wholly-untracked
      // directory to a single "dir/" entry, which callers cannot filter by path.
      this.git(repoPath, ['status', '--porcelain=v1', '--untracked-files=all']),
    ]);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const raw of porcelain.stdout.split('\n')) {
      if (!raw.trim()) continue;
      const code = raw.slice(0, 2);
      const path = raw.slice(3).trim();
      if (code === '??') untracked.push(path);
      else {
        if (code[0] !== ' ') staged.push(path);
        if (code[1] !== ' ') unstaged.push(path);
      }
    }

    return {
      branch,
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      staged,
      unstaged,
      untracked,
    };
  }

  async diff(repoPath: string, baseRef: string, headRef = 'HEAD'): Promise<string> {
    const result = await this.git(repoPath, ['diff', `${baseRef}...${headRef}`], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      const fallback = await this.git(repoPath, ['diff', baseRef, headRef], { allowFailure: true });
      return fallback.stdout;
    }
    return result.stdout;
  }

  async diffWorkingTree(repoPath: string): Promise<string> {
    const result = await this.git(repoPath, ['diff', 'HEAD'], { allowFailure: true });
    return result.stdout;
  }

  async changedFiles(repoPath: string, baseRef: string, headRef = 'HEAD'): Promise<FileChange[]> {
    const numstat = await this.git(repoPath, ['diff', '--numstat', `${baseRef}...${headRef}`], {
      allowFailure: true,
    });
    const nameStatus = await this.git(
      repoPath,
      ['diff', '--name-status', `${baseRef}...${headRef}`],
      { allowFailure: true },
    );

    const statusByPath = new Map<string, FileChange['changeType']>();
    for (const line of nameStatus.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [code, ...rest] = line.split('\t');
      const path = rest[rest.length - 1]?.trim();
      if (!path || !code) continue;
      const letter = code[0];
      statusByPath.set(
        path,
        letter === 'A'
          ? 'added'
          : letter === 'D'
            ? 'deleted'
            : letter === 'R'
              ? 'renamed'
              : 'modified',
      );
    }

    const changes: FileChange[] = [];
    for (const line of numstat.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [additions, deletions, path] = line.split('\t');
      if (!path) continue;
      changes.push({
        path: path.trim(),
        changeType: statusByPath.get(path.trim()) ?? 'modified',
        additions: additions === '-' ? 0 : Number.parseInt(additions ?? '0', 10) || 0,
        deletions: deletions === '-' ? 0 : Number.parseInt(deletions ?? '0', 10) || 0,
      });
    }
    return changes;
  }

  /** Stages the agent's complete worktree change set. */
  async stageAll(repoPath: string): Promise<void> {
    await this.git(repoPath, ['add', '--all', '--', '.'], {
      operation: 'add',
    });
  }

  async commit(repoPath: string, message: string): Promise<string | null> {
    await this.stageAll(repoPath);
    const status = await this.status(repoPath);
    if (status.staged.length === 0) {
      this.logger.warn({ repoPath }, 'git.commit.skipped_empty');
      return null;
    }
    await this.git(repoPath, ['commit', '--no-verify', '-m', message], { operation: 'commit' });
    const sha = await this.headSha(repoPath);
    this.logger.info({ repoPath, sha }, 'git.commit.created');
    return sha;
  }

  async push(
    repoPath: string,
    branch: string,
    remote = 'origin',
    authentication?: GitHttpAuthentication,
  ): Promise<CommandResult> {
    return this.git(repoPath, ['push', '--set-upstream', remote, branch], {
      timeoutMs: this.timeoutMs * 2,
      allowFailure: true,
      operation: 'push',
      authentication,
    });
  }

  async log(
    repoPath: string,
    limit = 20,
  ): Promise<{ sha: string; message: string; author: string; date: string }[]> {
    const result = await this.git(repoPath, [
      'log',
      `-${String(limit)}`,
      '--pretty=format:%H%x1f%s%x1f%an%x1f%aI',
    ]);
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', message = '', author = '', date = ''] = line.split('\x1f');
        return { sha, message, author, date };
      });
  }
}
