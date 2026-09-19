import { describe, expect, it } from 'vitest';
import { CheckType } from '@engloop/types';
import { resolveCheckCommand, scriptNameOf, skipDefaultReason } from './check-commands';

describe('resolveCheckCommand', () => {
  it('prefers what the repository configured', () => {
    expect(resolveCheckCommand({ lint: 'npm run lint' }, CheckType.LINT)).toEqual({
      commandLine: 'npm run lint',
      source: 'configured',
    });
  });

  it('falls back to the Node defaults', () => {
    expect(resolveCheckCommand({}, CheckType.UNIT)).toEqual({
      commandLine: 'pnpm test',
      source: 'default',
    });
  });
});

describe('scriptNameOf', () => {
  it.each([
    ['npm run lint', 'lint'],
    ['pnpm typecheck', 'typecheck'],
    ['npm test', 'test'],
    ['pnpm test:e2e', 'test:e2e'],
    ['yarn build', 'build'],
  ])('%s runs the %s script', (commandLine, script) => {
    expect(scriptNameOf(commandLine)).toBe(script);
  });

  it('is null for anything that is not a package script', () => {
    expect(scriptNameOf('make check')).toBeNull();
    expect(scriptNameOf('pnpm --filter web lint')).toBeNull();
    expect(scriptNameOf('')).toBeNull();
  });
});

describe('skipDefaultReason', () => {
  const manifest = (scripts: Record<string, string>) => ({ scripts });

  it('skips a default command when the worktree has no manifest', () => {
    const reason = skipDefaultReason({ commandLine: 'pnpm lint', source: 'default' }, null);
    expect(reason).toContain('parent project');
  });

  it('skips a default command the repository has no script for', () => {
    const reason = skipDefaultReason(
      { commandLine: 'pnpm typecheck', source: 'default' },
      manifest({ build: 'next build' }),
    );
    expect(reason).toContain('no "typecheck" script');
  });

  it('runs a default command the repository does have a script for', () => {
    expect(
      skipDefaultReason(
        { commandLine: 'pnpm lint', source: 'default' },
        manifest({ lint: 'eslint' }),
      ),
    ).toBeNull();
  });

  it('always runs a command the repository configured', () => {
    expect(skipDefaultReason({ commandLine: 'make check', source: 'configured' }, null)).toBeNull();
  });
});
