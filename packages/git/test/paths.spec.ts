import { describe, expect, it } from 'vitest';
import { buildBranchName, buildWorkspaceLayout, isInside, slugify, worktreePath } from '../src';

describe('workspace layout', () => {
  it('separates repositories from worktrees', () => {
    const layout = buildWorkspaceLayout('/tmp/workspace');
    expect(layout.repositories).toContain('repositories');
    expect(layout.worktrees).toContain('worktrees');
    expect(layout.repositories).not.toBe(layout.worktrees);
  });

  it('gives each task its own worktree directory', () => {
    const layout = buildWorkspaceLayout('/tmp/workspace');
    expect(worktreePath(layout, 'ENG-101')).not.toBe(worktreePath(layout, 'ENG-102'));
    expect(worktreePath(layout, 'ENG-101')).toContain('ENG-101');
  });

  it('sanitises a hostile task key into a safe directory name', () => {
    const layout = buildWorkspaceLayout('/tmp/workspace');
    const path = worktreePath(layout, '../../etc/passwd');
    expect(path).not.toContain('..');
    expect(isInside(layout.worktrees, path)).toBe(true);
  });
});

describe('branch naming', () => {
  it('follows agent/{task-key}-{slug}', () => {
    expect(buildBranchName('ENG-101', 'Implement organization invitations')).toBe(
      'agent/ENG-101-implement-organization-invitations',
    );
  });

  it('honours a configured prefix', () => {
    expect(buildBranchName('ENG-1', 'Fix', 'bot')).toBe('bot/ENG-1-fix');
  });

  it('produces a git-safe slug from awkward titles', () => {
    expect(slugify('Fix   the  *thing*!! (again)')).toBe('fix-the-thing-again');
    expect(slugify('')).toBe('task');
    expect(slugify('#'.repeat(50))).toBe('task');
  });
});

describe('isInside', () => {
  it('detects escapes', () => {
    expect(isInside('/tmp/workspace', '/tmp/workspace/worktrees/ENG-1')).toBe(true);
    expect(isInside('/tmp/workspace', '/tmp/other')).toBe(false);
  });
});
