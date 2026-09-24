import { join } from 'node:path';
import type { RunCommandInput } from '@engloop/git';
import type { CommandResult } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { HostProcessExecutionRuntime } from './host-process-execution-runtime';

const result = (input: RunCommandInput): CommandResult => ({
  command: input.command,
  args: [...input.args],
  cwd: input.cwd,
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  truncated: false,
  timedOut: false,
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(1).toISOString(),
  durationMs: 1,
});

const runtime = (run = vi.fn(async (input: RunCommandInput) => result(input))) => {
  const runner = { isAllowed: vi.fn((command: string) => command !== 'blocked'), run };
  return { host: new HostProcessExecutionRuntime({ runner: runner as never }), runner };
};

const workspace = join(process.cwd(), 'workspace', 'worktrees', 'ENG-1');
const prepare = (host: HostProcessExecutionRuntime, runId: string, secret = 'secret') =>
  host.prepare({
    runId,
    workspacePath: workspace,
    limits: { timeoutMs: 5_000, allowedCommands: ['codex'] },
    secretEnv: { API_KEY: secret },
    credentialSource: 'api-key',
  });

describe('HostProcessExecutionRuntime', () => {
  it('describes host execution honestly without exposing secrets', async () => {
    const { host } = runtime();
    const descriptor = await prepare(host, 'run-1');

    expect(descriptor).toMatchObject({
      runtimeId: expect.stringMatching(/^host-/u),
      kind: 'HOST_PROCESS',
      isolated: false,
      workspacePath: workspace,
      appliedLimits: { timeoutMs: 5_000, allowedCommands: ['codex'] },
      credentialSource: 'api-key',
    });
    expect(JSON.stringify(descriptor)).not.toContain('secret');
  });

  it('rejects unprepared runs, cwd escapes, and commands outside either allowlist', async () => {
    const { host, runner } = runtime();
    await expect(
      host.run({ scope: 'agent', runId: 'missing', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/not prepared/u);

    await prepare(host, 'run-1');
    await expect(
      host.run({
        scope: 'agent',
        runId: 'run-1',
        command: 'codex',
        args: [],
        cwd: join(workspace, '..', 'other'),
      }),
    ).rejects.toThrow(/outside/u);
    await expect(
      host.run({ scope: 'agent', runId: 'run-1', command: 'node', args: [], cwd: workspace }),
    ).rejects.toThrow(/not allowed/u);

    await host.release('run-1');
    await host.prepare({
      runId: 'run-2',
      workspacePath: workspace,
      limits: { timeoutMs: 5_000, allowedCommands: ['blocked'] },
      secretEnv: {},
      credentialSource: 'cli-login',
    });
    await expect(
      host.run({ scope: 'agent', runId: 'run-2', command: 'blocked', args: [], cwd: workspace }),
    ).rejects.toThrow(/not allowed/u);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('isolates concurrent per-run environments and clears them on release', async () => {
    const calls: RunCommandInput[] = [];
    const { host } = runtime(
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        return result(input);
      }),
    );
    await Promise.all([prepare(host, 'run-1', 'one'), prepare(host, 'run-2', 'two')]);

    await Promise.all([
      host.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
      host.run({ scope: 'agent', runId: 'run-2', command: 'codex', args: [], cwd: workspace }),
    ]);

    expect(calls.map((call) => call.env?.['API_KEY']).sort()).toEqual(['one', 'two']);
    await host.release('run-1');
    await expect(
      host.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/not prepared/u);
  });

  it('keeps health probes outside run sessions and does not attach run secrets', async () => {
    const { host, runner } = runtime();
    await prepare(host, 'run-1');

    await host.run({ scope: 'health', command: 'codex', args: ['--version'], cwd: process.cwd() });

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ env: {}, command: 'codex', args: ['--version'] }),
    );
  });

  it('cancels active runs and shutdown aborts every remaining session', async () => {
    const signals = new Map<string, AbortSignal>();
    const { host } = runtime(
      vi.fn(async (input: RunCommandInput) => {
        const id = input.label ?? 'unknown';
        if (input.signal) signals.set(id, input.signal);
        return await new Promise<CommandResult>((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
            { once: true },
          );
        });
      }),
    );
    await Promise.all([prepare(host, 'run-1'), prepare(host, 'run-2')]);
    const first = host.run({
      scope: 'agent',
      runId: 'run-1',
      command: 'codex',
      args: [],
      cwd: workspace,
      label: 'one',
    });
    const second = host.run({
      scope: 'agent',
      runId: 'run-2',
      command: 'codex',
      args: [],
      cwd: workspace,
      label: 'two',
    });

    await host.cancel('run-1');
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(signals.get('one')?.aborted).toBe(true);

    await host.shutdown();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(signals.get('two')?.aborted).toBe(true);
    await expect(
      host.run({ scope: 'agent', runId: 'run-2', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/closed/u);
  });

  it('permanently rejects prepare once shutdown begins and clears run credentials', async () => {
    const { host, runner } = runtime();
    await prepare(host, 'run-1', 'must-not-survive');

    const shuttingDown = host.shutdown();
    await expect(prepare(host, 'run-2', 'new-secret')).rejects.toThrow(/shutting-down|closed/u);
    await shuttingDown;

    await expect(prepare(host, 'run-3', 'later-secret')).rejects.toThrow(/closed/u);
    await expect(
      host.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/closed/u);
    expect(runner.run).not.toHaveBeenCalled();
    await expect(host.shutdown()).resolves.toBeUndefined();
  });
});
