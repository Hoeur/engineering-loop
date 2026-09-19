import type { CommandResult } from '@engloop/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitOperationError, GitService } from '../src';

const result = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  command: 'git',
  args: [],
  cwd: process.cwd(),
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  truncated: false,
  timedOut: false,
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  durationMs: 0,
  ...overrides,
});

describe('GitService authenticated operations', () => {
  it('passes a token only through non-logged environment values', async () => {
    const token = 'github-installation-secret';
    let captured:
      | {
          args: string[];
          env?: Record<string, string>;
        }
      | undefined;
    const run = vi.fn().mockImplementation(
      async (input: { args: string[]; env?: Record<string, string> }) => {
        captured = { args: [...input.args], env: input.env ? { ...input.env } : undefined };
        return result();
      },
    );
    const git = new GitService({
      runner: { run } as never,
      identity: { name: 'EngLoop', email: 'agents@example.com' },
    });

    await git.push('/repo', 'agent/ENG-1', 'origin', { token });

    const input = captured as unknown as {
      args: string[];
      env?: Record<string, string>;
    };
    expect(input.args.join(' ')).not.toContain(token);
    expect(JSON.stringify(input.args)).not.toContain(token);
    expect(input.env?.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
    expect(input.env?.GIT_CONFIG_VALUE_0).not.toContain(token);
    expect(input.env?.GIT_CONFIG_KEY_1).toBe('credential.helper');
    expect(input.env?.GIT_CONFIG_VALUE_1).toBe('');
    expect(input.env?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(input.env?.GCM_INTERACTIVE).toBe('Never');
    expect(run.mock.calls[0]?.[0].env.GIT_CONFIG_VALUE_0).toBe('');
  });

  it('redacts raw and encoded credentials from failed git output', async () => {
    const token = 'github-installation-secret';
    const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    const run = vi.fn().mockResolvedValue(
      result({ exitCode: 128, stderr: `fatal ${token} Authorization basic ${encoded}` }),
    );
    const git = new GitService({
      runner: { run } as never,
      identity: { name: 'EngLoop', email: 'agents@example.com' },
    });

    let thrown: unknown;
    try {
      await git.fetch('/repo', 'origin', { token });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GitOperationError);
    expect(String(thrown)).not.toContain(token);
    expect(String(thrown)).not.toContain(encoded);
    expect(String(thrown)).toContain('[REDACTED]');
  });

  it('fails closed when an authenticated fetch fails', async () => {
    const run = vi.fn().mockResolvedValue(result({ exitCode: 1, stderr: 'access denied' }));
    const git = new GitService({
      runner: { run } as never,
      identity: { name: 'EngLoop', email: 'agents@example.com' },
    });

    await expect(git.fetch('/repo', 'origin', { token: 'secret' })).rejects.toBeInstanceOf(
      GitOperationError,
    );
  });

  it('uses the same environment-only credential path for clone', async () => {
    const token = 'clone-installation-secret';
    let captured: { args: string[]; env?: Record<string, string> } | undefined;
    const run = vi.fn().mockImplementation(
      async (input: { args: string[]; env?: Record<string, string> }) => {
        captured = { args: [...input.args], env: input.env ? { ...input.env } : undefined };
        return result();
      },
    );
    const git = new GitService({
      runner: { run } as never,
      identity: { name: 'EngLoop', email: 'agents@example.com' },
    });

    await git.clone(
      'https://github.com/engloop/private.git',
      join(tmpdir(), 'engloop-private-clone'),
      'main',
      { token },
    );

    expect(captured?.args.join(' ')).not.toContain(token);
    expect(captured?.env?.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
  });

  it('rejects credential-bearing HTTP remotes before invoking git', async () => {
    const run = vi.fn().mockResolvedValue(result());
    const git = new GitService({
      runner: { run } as never,
      identity: { name: 'EngLoop', email: 'agents@example.com' },
    });

    await expect(
      git.clone(
        'https://installation-token@github.com/engloop/private.git',
        join(tmpdir(), 'engloop-rejected-clone'),
      ),
    ).rejects.toThrow('Credential-bearing remote URLs are forbidden');
    expect(run).not.toHaveBeenCalled();
  });
});
