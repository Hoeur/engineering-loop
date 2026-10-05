import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CommandRunner } from '@engloop/git';
import type { RunCommandInput } from '@engloop/git';
import { DockerContainerExecutionRuntime } from '../../src/execution/docker-container-execution-runtime';

const image = process.env.ENGLOOP_DOCKER_TEST_IMAGE ?? 'engloop-runtime-test:local';
const runner = new CommandRunner({
  allowlist: ['git', 'docker', 'node'],
  defaultTimeoutMs: 30_000,
  maxBufferBytes: 1_048_576,
});

describe('Docker runtime live containment', () => {
  let root: string;
  let workspace: string;
  let repository: string;
  let sibling: string;
  let runtime: DockerContainerExecutionRuntime;
  const runId = (): string => `integration-${randomUUID()}`;
  const host = (command: string, args: string[], cwd = root) =>
    runner.run({ command, args, cwd, throwOnFailure: true });
  const makeRuntime = (dockerRunner = runner, selectedImage = image) =>
    new DockerContainerExecutionRuntime({
      runner,
      dockerRunner,
      dockerCommand: 'docker',
      image: selectedImage,
      controlRoot: join(root, 'control'),
      cpuCount: 1,
      memoryBytes: 268_435_456,
      pids: 64,
    });
  const prepare = (id: string) =>
    runtime.prepare({
      runId: id,
      workspacePath: workspace,
      limits: { timeoutMs: 15_000, allowedCommands: ['node', 'git'] },
      secretEnv: { OPENAI_API_KEY: 'integration-placeholder-no-provider-calls' },
      credentialSource: 'api-key',
    });
  const execute = (id: string, script: string, args: string[] = []) =>
    runtime.run({
      scope: 'agent',
      runId: id,
      command: 'node',
      args: ['-e', script, ...args],
      cwd: workspace,
    });
  const absent = async (name: string) => {
    const result = await runner.run({ command: 'docker', args: ['inspect', name], cwd: root });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/no such (object|container)/iu);
  };

  beforeAll(async () => {
    // A requested integration gate must fail when prerequisites are unavailable.
    await runner.run({
      command: 'docker',
      args: ['info'],
      cwd: resolve('.'),
      throwOnFailure: true,
    });
    await runner.run({
      command: 'docker',
      args: ['image', 'inspect', image],
      cwd: resolve('.'),
      throwOnFailure: true,
    });
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'engloop-docker-integration-'));
    repository = join(root, 'repositories', 'source');
    workspace = join(root, 'worktrees', 'assigned');
    sibling = join(root, 'worktrees', 'sibling');
    await mkdir(repository, { recursive: true });
    await host('git', ['init', repository]);
    await writeFile(join(repository, 'tracked.txt'), 'committed\n');
    await host('git', ['add', '.'], repository);
    await host(
      'git',
      [
        '-c',
        'user.name=Integration',
        '-c',
        'user.email=integration@example.invalid',
        'commit',
        '-m',
        'fixture',
      ],
      repository,
    );
    await host('git', ['worktree', 'add', '-b', 'assigned', workspace], repository);
    await host('git', ['worktree', 'add', '-b', 'sibling', sibling], repository);
    await writeFile(join(root, 'host-secret.txt'), 'host-only');
    await writeFile(join(repository, 'repository-secret.txt'), 'repository-only');
    await writeFile(join(sibling, 'sibling-secret.txt'), 'sibling-only');
    runtime = makeRuntime();
  });
  afterEach(async () => {
    await runtime?.shutdown();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('isolates host, repository, sibling paths and symlink escapes while preserving assigned files and private Git', async () => {
    const id = runId();
    await symlink(
      sibling,
      join(workspace, 'host-junction'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const descriptor = await prepare(id);
    const hostPaths = [
      join(root, 'host-secret.txt'),
      join(repository, 'repository-secret.txt'),
      join(sibling, 'sibling-secret.txt'),
    ];
    const paths = hostPaths.flatMap((path) =>
      process.platform === 'win32'
        ? [
            path,
            '/run/desktop/mnt/host/' +
              path
                .replace(/^([A-Z]):/iu, (_, drive: string) => drive.toLowerCase())
                .replace(/\\/gu, '/'),
          ]
        : [path],
    );
    const result = await execute(
      id,
      `
      const fs = require('node:fs');
      const paths = JSON.parse(process.argv[1]);
      for (const [index, path] of paths.entries()) {
        if (fs.existsSync(path)) throw new Error('host path exposed');
        fs.symlinkSync(path, '/workspace/escape-' + index);
        try { fs.readFileSync('/workspace/escape-' + index); throw new Error('symlink escaped'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      for (const path of ['/workspace/host-junction/sibling-secret.txt', '/workspace/../host-secret.txt', '/repositories/source/repository-secret.txt', '/var/run/docker.sock']) {
        if (fs.existsSync(path)) throw new Error('unexpected mount: ' + path);
      }
      if (fs.readFileSync('/workspace/tracked.txt', 'utf8').trim() !== 'committed') throw new Error('assigned file missing');
      fs.writeFileSync('/workspace/generated.txt', 'agent change');
      console.log('contained');
    `,
      [JSON.stringify(paths)],
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('contained');
    expect(await readFile(join(workspace, 'generated.txt'), 'utf8')).toBe('agent change');
    const git = await runtime.run({
      scope: 'agent',
      runId: id,
      command: 'git',
      args: ['-c', 'safe.directory=/workspace', 'status', '--porcelain'],
      cwd: workspace,
    });
    expect(git.exitCode).toBe(0);
    expect(git.stdout).toContain('generated.txt');
    const mounts = JSON.parse(
      (await host('docker', ['inspect', '--format', '{{json .Mounts}}', descriptor.containerName]))
        .stdout,
    ) as { Source: string; Destination: string }[];
    expect(mounts.map((mount) => mount.Destination).sort()).toEqual([
      '/engloop-control',
      '/workspace',
      '/workspace/.git',
    ]);
    expect(mounts.some((mount) => mount.Source.includes('repositories'))).toBe(false);
    await runtime.release(id);
    await absent(descriptor.containerName);
  });

  it('fails closed when Docker cannot create the requested image', async () => {
    runtime = makeRuntime(runner, `engloop-missing-${randomUUID()}:missing`);
    const id = runId();
    await expect(prepare(id)).rejects.toThrow();
    await expect(execute(id, 'console.log("host fallback")')).rejects.toThrow(/not prepared/u);
    const containers = await host('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=engloop.run-id=${id}`,
    ]);
    expect(containers.stdout.trim()).toBe('');
  });

  it('removes a real partial container when Docker start fails', async () => {
    class StartFailureRunner extends CommandRunner {
      override run(input: RunCommandInput) {
        if (input.command === 'docker' && input.args[0] === 'create') {
          return super.run({
            ...input,
            args: [
              'create',
              '--entrypoint',
              '/engloop-nonexistent-executable',
              ...input.args.slice(1),
            ],
          });
        }
        return super.run(input);
      }
    }
    runtime = makeRuntime(
      new StartFailureRunner({
        allowlist: ['docker'],
        defaultTimeoutMs: 30_000,
        maxBufferBytes: 1_048_576,
      }),
    );
    const id = runId();
    await expect(prepare(id)).rejects.toThrow();
    await expect(execute(id, 'console.log("host fallback")')).rejects.toThrow(/not prepared/u);
    expect(
      (await host('docker', ['ps', '-aq', '--filter', `label=engloop.run-id=${id}`])).stdout.trim(),
    ).toBe('');
  });

  it('cancellation removes a container with an executing process', async () => {
    const id = runId();
    const descriptor = await prepare(id);
    const running = execute(
      id,
      'require("node:fs").writeFileSync("/workspace/started", "ready"); setInterval(() => {}, 1000)',
    ).catch((error: unknown) => error);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await access(join(workspace, 'started')).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    await access(join(workspace, 'started'));
    await runtime.cancel(id);
    await running;
    await absent(descriptor.containerName);
    await expect(execute(id, 'console.log("after cancel")')).rejects.toThrow(/cancelled/u);
  });

  it('timeout removes the container instead of leaving an exec process running', async () => {
    const id = runId();
    const descriptor = await prepare(id);
    await expect(
      runtime.run({
        scope: 'agent',
        runId: id,
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: workspace,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/timeout/u);
    await absent(descriptor.containerName);
  });

  it('prunes completed invocation directories and permits a second provider invocation', async () => {
    const id = runId();
    await prepare(id);
    const first = await runtime.createInvocationDirectory(id);
    expect(
      (
        await execute(id, 'require("node:fs").writeFileSync(process.argv[1], "{}")', [
          join(first, 'output.json'),
        ])
      ).exitCode,
    ).toBe(0);
    await rm(first, { recursive: true });
    const second = await runtime.createInvocationDirectory(id);
    expect(
      (
        await execute(id, 'require("node:fs").writeFileSync(process.argv[1], "{}")', [
          join(second, 'output.json'),
        ])
      ).exitCode,
    ).toBe(0);
  });

  it('rejects an invocation parent replaced by a symlink before host output access', async () => {
    const id = runId();
    const descriptor = await prepare(id);
    await runtime.createInvocationDirectory(id);
    await expect(
      execute(
        id,
        `const fs = require('node:fs'); fs.rmSync('/engloop-control/invocations', { recursive: true }); fs.symlinkSync('/engloop-control/home', '/engloop-control/invocations');`,
      ),
    ).rejects.toThrow(/Invalid provider invocation directory/u);
    await absent(descriptor.containerName);
  });

  it('shutdown removes every prepared container and control directory', async () => {
    const ids = [runId(), runId()];
    const descriptors = await Promise.all(ids.map(prepare));
    await runtime.shutdown();
    for (const descriptor of descriptors) {
      await absent(descriptor.containerName);
      await expect(access(join(root, 'control', descriptor.runtimeId))).rejects.toThrow();
    }
    await expect(prepare(runId())).rejects.toThrow(/closed/u);
  });
});
