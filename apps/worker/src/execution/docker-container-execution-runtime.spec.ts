import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunCommandInput } from '@engloop/git';
import type { CommandResult } from '@engloop/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockerContainerExecutionRuntime } from './docker-container-execution-runtime';

const temporaryDirectories: string[] = [];

const makeLayout = async () => {
  const root = await mkdtemp(join(tmpdir(), 'engloop-docker-runtime-'));
  temporaryDirectories.push(root);
  const workspace = join(root, 'worktrees', 'ENG-1');
  const controlRoot = join(root, 'runtime-control');
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, '.git'),
    'gitdir: C:/engloop/workspace/repositories/repo.git/worktrees/ENG-1\n',
    'utf8',
  );
  return { root, workspace, controlRoot };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const result = (input: RunCommandInput, overrides: Partial<CommandResult> = {}): CommandResult => ({
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
  ...overrides,
});

const makeRuntime = (
  controlRoot: string,
  run = vi.fn(async (input: RunCommandInput) => result(input)),
) => {
  const runner = {
    isAllowed: vi.fn((command: string) => ['docker', 'git', 'codex'].includes(command)),
    run,
  };
  return {
    runtime: new DockerContainerExecutionRuntime({
      runner: runner as never,
      dockerRunner: runner as never,
      dockerCommand: 'docker',
      image: 'engloop-agent:test',
      controlRoot,
      cpuCount: 1.5,
      memoryBytes: 536_870_912,
      pids: 128,
    }),
    runner,
  };
};

const prepare = (
  runtime: DockerContainerExecutionRuntime,
  workspacePath: string,
  runId = 'run-1',
) =>
  runtime.prepare({
    runId,
    workspacePath,
    limits: { timeoutMs: 5_000, allowedCommands: ['codex'] },
    secretEnv: { CODEX_API_KEY: 'sk-secret', OPENAI_API_KEY: 'sk-secret' },
    credentialSource: 'api-key',
  });

describe('DockerContainerExecutionRuntime', () => {
  it('keeps a failed preparation unusable when cleanup fails and retries release', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    let failCleanup = true;
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        if (input.args[0] === 'start') throw new Error('start failed');
        if (input.args[0] === 'rm' && failCleanup)
          return result(input, { exitCode: 1, stderr: 'cleanup failed' });
        return result(input);
      }),
    );
    await expect(prepare(runtime, workspace)).rejects.toThrow('cleanup failed');
    await expect(
      runtime.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/cancelled/u);
    expect(calls.some((call) => call.args[0] === 'exec')).toBe(false);
    failCleanup = false;
    await runtime.release('run-1');
    expect(calls.filter((call) => call.args[0] === 'rm')).toHaveLength(2);
  });

  it('rejects oversized provider output before reading it into host memory', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const { runtime } = makeRuntime(controlRoot);
    await prepare(runtime, workspace);
    const directory = await runtime.createInvocationDirectory('run-1');
    await writeFile(join(directory, 'output.json'), 'x'.repeat(16 * 1024 * 1024 + 1));
    await expect(
      runtime.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/exceeds 16 MiB/u);
    await runtime.release('run-1');
  });

  it('scrubs credentials and translates the provider request before returning output', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        return result(input, { stdout: 'sk-secret', stderr: 'error sk-secret' });
      }),
    );
    await prepare(runtime, workspace);
    const output = await runtime.run({
      scope: 'agent',
      runId: 'run-1',
      command: 'codex',
      args: [],
      cwd: workspace,
      stdin: JSON.stringify({
        repository: { rootPath: workspace },
        input: { description: 'unchanged' },
      }),
    });
    expect(output.stdout).toBe('[REDACTED]');
    expect(output.stderr).toBe('error [REDACTED]');
    const command = calls.find((call) => call.args[0] === 'exec');
    expect(JSON.parse(command?.stdin ?? '{}')).toEqual({
      repository: { rootPath: '/workspace' },
      input: { description: 'unchanged' },
    });
    await runtime.release('run-1');
  });

  it('retains failed removal for retry and refuses further commands', async () => {
    const { workspace, controlRoot } = await makeLayout();
    let failRemoval = true;
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) =>
        result(
          input,
          input.args[0] === 'rm' && failRemoval ? { exitCode: 1, stderr: 'daemon offline' } : {},
        ),
      ),
    );
    await prepare(runtime, workspace);
    await expect(runtime.release('run-1')).rejects.toThrow('daemon offline');
    await expect(
      runtime.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow('cancelled');
    failRemoval = false;
    await runtime.release('run-1');
  });

  it('waits for preparation on shutdown and cleans a container started during the race', async () => {
    const { workspace, controlRoot } = await makeLayout();
    let resumeStart: (() => void) | undefined;
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        if (input.args[0] === 'start')
          await new Promise<void>((resolve) => {
            resumeStart = resolve;
          });
        return result(input);
      }),
    );
    const prepared = prepare(runtime, workspace);
    const rejected = expect(prepared).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(resumeStart).toBeDefined());
    await expect(prepare(runtime, workspace)).rejects.toThrow('already prepared');
    const stopped = runtime.shutdown();
    resumeStart?.();
    await rejected;
    await stopped;
    expect(calls.some((call) => call.args[0] === 'rm')).toBe(true);
  });

  it('cleans named health containers when the client times out', async () => {
    const { controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        if (input.args[0] === 'run') throw new Error('timed out');
        return result(input);
      }),
    );
    await expect(
      runtime.run({ scope: 'health', command: 'codex', args: ['--version'], cwd: '.' }),
    ).rejects.toThrow('timed out');
    const health = calls.find((call) => call.args[0] === 'run');
    const name = health?.args[(health?.args.indexOf('--name') ?? 0) + 1];
    expect(calls.some((call) => call.args[0] === 'rm' && call.args[2] === name)).toBe(true);
  });
  it('creates one bounded container with only the worktree, control directory, and git-file mask', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        return result(
          input,
          input.command === 'docker' && input.args[0] === 'create'
            ? { stdout: 'container-id\n' }
            : {},
        );
      }),
    );

    const descriptor = await prepare(runtime, workspace);

    expect(descriptor).toMatchObject({
      kind: 'DOCKER_CONTAINER',
      isolated: true,
      containerName: expect.stringMatching(/^engloop-agent-run-1-/u),
      appliedLimits: {
        timeoutMs: 5_000,
        allowedCommands: ['codex'],
        cpuCount: 1.5,
        memoryBytes: 536_870_912,
        pids: 128,
        network: 'none',
      },
    });
    expect(JSON.stringify(descriptor)).not.toContain('sk-secret');
    const create = calls.find((call) => call.command === 'docker' && call.args[0] === 'create');
    expect(create?.args).toEqual(
      expect.arrayContaining([
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,size=64m',
        '--cpus',
        '1.5',
        '--memory',
        '536870912',
        '--pids-limit',
        '128',
      ]),
    );
    expect(create?.args.filter((argument) => argument === '--mount')).toHaveLength(3);
    expect(create?.args.join(' ')).not.toContain('repositories/repo.git');
    const gitFileMount = create?.args.find((argument) => argument.includes('workspace.git')) ?? '';
    const hostGitFile = gitFileMount.match(/source=(.*),target=/u)?.[1] ?? '';
    expect(await readFile(hostGitFile, 'utf8')).toBe('gitdir: /engloop-control/git-shadow/.git\n');
    expect(
      calls.filter((call) => call.command === 'docker' && call.args[0] === 'create'),
    ).toHaveLength(1);

    await runtime.release('run-1');
    expect(
      calls.some(
        (call) => call.command === 'docker' && call.args[0] === 'rm' && call.args[1] === '--force',
      ),
    ).toBe(true);
  });

  it('keeps provider files in control storage, translates host paths, and puts only env names in argv', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        return result(
          input,
          input.command === 'docker' && input.args[0] === 'exec' ? { stdout: 'ok' } : {},
        );
      }),
    );
    await prepare(runtime, workspace);
    const invocation = await runtime.createInvocationDirectory('run-1');
    const schemaFile = join(invocation, 'response-schema.json');
    await writeFile(schemaFile, '{}', 'utf8');
    await writeFile(join(invocation, 'output.json'), 'sk-secret', 'utf8');

    await runtime.run({
      scope: 'agent',
      runId: 'run-1',
      command: 'codex',
      args: ['exec', '--cd', workspace, '--output-schema', schemaFile],
      cwd: workspace,
      stdin: '{}',
    });

    const execute = calls.find((call) => call.command === 'docker' && call.args[0] === 'exec');
    expect(execute?.args).toEqual(
      expect.arrayContaining([
        '--env',
        'CODEX_API_KEY',
        '--env',
        'OPENAI_API_KEY',
        '--workdir',
        '/workspace',
        '/workspace',
        expect.stringMatching(/^\/engloop-control\/invocations\//u),
      ]),
    );
    expect(execute?.args.join(' ')).not.toContain('sk-secret');
    expect(execute?.args.join(' ')).not.toContain(workspace);
    expect(execute?.args.join(' ')).not.toContain(controlRoot);
    expect(execute?.env).toMatchObject({
      CODEX_API_KEY: 'sk-secret',
      OPENAI_API_KEY: 'sk-secret',
      HOME: '/engloop-control/home',
      TMPDIR: '/tmp',
    });
    expect(await readFile(join(invocation, 'output.json'), 'utf8')).toBe('[REDACTED]');

    await runtime.release('run-1');
    await expect(access(invocation)).rejects.toThrow();
  });

  it('fails closed on container start failure and force-removes the partial container', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        if (input.command === 'docker' && input.args[0] === 'start') {
          throw new Error('daemon refused start');
        }
        return result(input);
      }),
    );

    await expect(prepare(runtime, workspace)).rejects.toThrow('daemon refused start');
    expect(
      calls.some(
        (call) => call.command === 'docker' && call.args[0] === 'rm' && call.args[1] === '--force',
      ),
    ).toBe(true);
    await expect(
      runtime.run({ scope: 'agent', runId: 'run-1', command: 'codex', args: [], cwd: workspace }),
    ).rejects.toThrow(/not prepared/u);
  });

  it('fails closed on container create failure without preparing a host fallback', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        if (input.command === 'docker' && input.args[0] === 'create') {
          throw new Error('daemon refused create');
        }
        return result(input);
      }),
    );

    await expect(prepare(runtime, workspace)).rejects.toThrow('daemon refused create');
    expect(calls.some((call) => call.command === 'docker' && call.args[0] === 'rm')).toBe(true);
    expect(calls.some((call) => call.command === 'codex')).toBe(false);
  });

  it('force-removes containers on cancel and shutdown', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const calls: RunCommandInput[] = [];
    const { runtime } = makeRuntime(
      controlRoot,
      vi.fn(async (input: RunCommandInput) => {
        calls.push(input);
        return result(input);
      }),
    );
    await prepare(runtime, workspace, 'run-1');
    await prepare(runtime, workspace, 'run-2');

    await runtime.cancel('run-1');
    await runtime.shutdown();

    const removedNames = calls
      .filter(
        (call) => call.command === 'docker' && call.args[0] === 'rm' && call.args[1] === '--force',
      )
      .map((call) => call.args[2]);
    expect(new Set(removedNames).size).toBe(2);
  });

  it('rejects host login credentials and non-linked repositories before creating a container', async () => {
    const { workspace, controlRoot } = await makeLayout();
    const { runtime, runner } = makeRuntime(controlRoot);
    await expect(
      runtime.prepare({
        runId: 'run-login',
        workspacePath: workspace,
        limits: { timeoutMs: 5_000, allowedCommands: ['codex'] },
        secretEnv: {},
        credentialSource: 'cli-login',
      }),
    ).rejects.toThrow(/requires a stored API key/u);

    await rm(join(workspace, '.git'), { force: true });
    await mkdir(join(workspace, '.git'));
    await expect(prepare(runtime, workspace)).rejects.toThrow(/linked Git worktree/u);
    expect(runner.run).not.toHaveBeenCalled();
  });
});
