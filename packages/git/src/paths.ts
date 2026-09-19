import { join, resolve } from 'node:path';

/** Deterministic, collision-free layout for the agent workspace (spec section 11). */
export interface WorkspaceLayout {
  root: string;
  repositories: string;
  worktrees: string;
  artifacts: string;
}

export const buildWorkspaceLayout = (workspaceRoot: string): WorkspaceLayout => {
  const root = resolve(workspaceRoot);
  return {
    root,
    repositories: join(root, 'repositories'),
    worktrees: join(root, 'worktrees'),
    artifacts: join(root, 'artifacts'),
  };
};

export const repositoryCheckoutPath = (layout: WorkspaceLayout, repositoryId: string): string =>
  join(layout.repositories, sanitizeSegment(repositoryId));

export const worktreePath = (layout: WorkspaceLayout, taskKey: string): string =>
  join(layout.worktrees, sanitizeSegment(taskKey));

export const slugify = (input: string, maxLength = 48): string =>
  input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '') || 'task';

/** `agent/{task-key}-{slug}` — the only branch shape agents may create. */
export const buildBranchName = (taskKey: string, title: string, prefix = 'agent'): string =>
  `${prefix}/${taskKey}-${slugify(title)}`;

/**
 * Makes an arbitrary string safe to use as a single path segment.
 *
 * Task keys reach this from agent and API input, so the result must never be
 * able to traverse: every separator becomes `_`, and runs of dots are collapsed
 * so a segment can never be `.`, `..`, or contain a `..` sequence.
 */
export const sanitizeSegment = (input: string): string => {
  const safe = input
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[.]+/, '')
    .slice(0, 120);
  return safe.length > 0 ? safe : 'unnamed';
};

/** Guards against `../` escapes when resolving agent-supplied relative paths. */
export const isInside = (parent: string, child: string): boolean => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`) || c.startsWith(`${p}\\`);
};
