/**
 * Real-Docker proof of the OPS-001 sandbox guarantees. Runs when the sandbox
 * image is present (`docker build -f docker/agent-sandbox.Dockerfile -t
 * engloop/agent-sandbox:local .`); ENGLOOP_SANDBOX_IT=1 makes a missing image a
 * failure instead of a skip.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRunner } from '@engloop/git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ContainerExecutionRuntime,
  SandboxUnavailableError,
  type ContainerRuntimeConfig,
} from '../src/execution';

const IMAGE = process.env.AGENT_SANDBOX_IMAGE ?? 'engloop/agent-sandbox:local';
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });
const available = docker('image', 'inspect', IMAGE).status === 0;
const required = process.env.ENGLOOP_SANDBOX_IT === '1';
if (required && !available) throw new Error(`ENGLOOP_SANDBOX_IT=1 but image ${IMAGE} is missing`);

const owner = `engloop-it-${randomUUID().slice(0, 8)}`;
const upstreamNet = `${owner}-up`;
const upstream = `${owner}-upstream`;
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

let root: string;
let worktree: string;
let sibling: string;

const runner = new CommandRunner({
  allowlist: ['docker'],
  defaultTimeoutMs: 60_000,
  maxBufferBytes: 1024 * 1024,
});

const createRuntime = (overrides: Partial<ContainerRuntimeConfig> = {}) =>
  new ContainerExecutionRuntime({
    runner,
    config: {
      dockerPath: 'docker',
      image: IMAGE,
      proxyImage: IMAGE,
      user: `${String(uid === 0 ? 65_534 : uid)}:${String(uid === 0 ? 65_534 : gid)}`,
      owner,
      scratchRoot: join(root, 'sandbox'),
      cpus: 1,
      memoryMb: 128,
      pidsLimit: 64,
      tmpfsMb: 16,
      egressAllowlist: [],
      egressNetwork: upstreamNet,
      commandAllowlist: ['sh', 'node', 'cat', 'sleep', 'ls'],
      ...overrides,
    },
  });

const prepare = (
  runtime: ContainerExecutionRuntime,
  runId: string,
  options: { timeoutMs?: number; egress?: string[]; secret?: string } = {},
) =>
  runtime.prepare({
    runId,
    workspacePath: worktree,
    limits: {
      timeoutMs: options.timeoutMs ?? 60_000,
      allowedCommands: ['sh', 'node', 'cat', 'sleep', 'ls'],
      egressAllowlist: options.egress,
    },
    secretEnv: { RUN_SECRET: options.secret ?? 'sandbox-secret-value' },
    credentialSource: 'api-key',
  });

const exec = (
  runtime: ContainerExecutionRuntime,
  runId: string,
  command: string,
  ...args: string[]
) => runtime.run({ scope: 'agent', runId, command, args, cwd: worktree, label: 'it' });

const ownedContainers = () =>
  docker('ps', '--all', '--filter', `label=engloop.owner=${owner}`, '--format', '{{.Names}}')
    .stdout.split(/\s+/u)
    .filter(Boolean);

const CONNECT_SCRIPT = `
const net = require('node:net');
const proxy = new URL(process.env.HTTPS_PROXY);
const target = process.argv[1];
const socket = net.connect(Number(proxy.port), proxy.hostname, () =>
  socket.write('CONNECT ' + target + ' HTTP/1.1\\r\\nHost: ' + target + '\\r\\n\\r\\n'));
let out = '';
socket.on('data', (chunk) => { out += chunk; if (out.includes('HELLO') || out.includes('403')) socket.end(); });
socket.on('close', () => { process.stdout.write(out); });
socket.on('error', (error) => { process.stdout.write('ERR ' + error.code); });
`;

describe.skipIf(!available)('ContainerExecutionRuntime (real Docker)', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'engloop-sandbox-it-'));
    worktree = join(root, 'worktrees', 'ENG-1');
    sibling = join(root, 'worktrees', 'ENG-2');
    await mkdir(worktree, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, 'secret.txt'), 'sibling-worktree-secret');
    await writeFile(join(root, 'auth.json'), 'host-credential-secret');
    expect(docker('network', 'create', upstreamNet).status).toBe(0);
    const started = docker(
      'run',
      '--detach',
      '--name',
      upstream,
      '--network',
      upstreamNet,
      '--label',
      `engloop.it=${owner}`,
      '--entrypoint',
      'node',
      IMAGE,
      '-e',
      "require('node:net').createServer((s)=>s.end('HELLO\\n')).listen(8443)",
    );
    expect(started.status).toBe(0);
  }, 120_000);

  afterAll(async () => {
    const leftovers = [...ownedContainers(), upstream];
    docker('rm', '--force', ...leftovers);
    docker('network', 'rm', upstreamNet);
    for (const net of docker(
      'network',
      'ls',
      '--filter',
      `label=engloop.owner=${owner}`,
      '--format',
      '{{.Name}}',
    )
      .stdout.split(/\s+/u)
      .filter(Boolean)) {
      docker('network', 'rm', net);
    }
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);

  it('confines the agent to its worktree on a read-only, non-root, capability-free filesystem', async () => {
    const runtime = createRuntime();
    const descriptor = await prepare(runtime, 'fs');
    expect(descriptor).toMatchObject({ kind: 'CONTAINER', isolated: true });

    const write = await exec(runtime, 'fs', 'sh', '-c', 'echo from-agent > out.txt && id -u');
    expect(write.exitCode).toBe(0);
    expect(write.stdout.trim()).not.toBe('0');
    expect(await readFile(join(worktree, 'out.txt'), 'utf8')).toBe('from-agent\n');

    for (const path of [join(sibling, 'secret.txt'), join(root, 'auth.json')]) {
      const read = await exec(runtime, 'fs', 'cat', path);
      expect(read.exitCode).not.toBe(0);
      expect(read.stdout).not.toMatch(/secret/u);
    }
    const listing = await exec(runtime, 'fs', 'sh', '-c', `ls -a /workspace/..; ls ${root} 2>&1`);
    expect(listing.stdout).not.toContain('ENG-2');

    const rootfs = await exec(runtime, 'fs', 'sh', '-c', 'touch /usr/local/x');
    expect(rootfs.exitCode).not.toBe(0);
    const caps = await exec(runtime, 'fs', 'sh', '-c', 'grep CapEff /proc/self/status');
    expect(caps.stdout).toMatch(/CapEff:\s+0+\s*$/u);

    const report = await runtime.release('fs');
    expect(report?.exitReason).toBe('COMPLETED');
    expect(ownedContainers()).toEqual([]);
  }, 120_000);

  it('passes secrets into the run without exposing them in argv or docker inspect', async () => {
    const runtime = createRuntime();
    const descriptor = await prepare(runtime, 'secret', { secret: 'only-in-env-7f3a' });
    const read = await exec(runtime, 'secret', 'sh', '-c', 'printf %s "$RUN_SECRET"');
    expect(read.stdout).toBe('only-in-env-7f3a');

    const container = descriptor.runtimeId.replace(/^container-/u, 'engloop-run-');
    expect(docker('inspect', container).stdout).not.toContain('only-in-env-7f3a');
    const procs = await exec(
      runtime,
      'secret',
      'sh',
      '-c',
      'cat /proc/1/cmdline /proc/1/environ | tr "\\0" " "',
    );
    expect(procs.stdout).not.toContain('only-in-env-7f3a');
    expect(JSON.stringify(descriptor)).not.toContain('only-in-env-7f3a');
    await runtime.release('secret');
  }, 120_000);

  it('has no network at all without an egress allowlist', async () => {
    const runtime = createRuntime();
    await prepare(runtime, 'offline');
    const probe = await exec(
      runtime,
      'offline',
      'node',
      '-e',
      "require('node:net').connect(8443, process.argv[1]).on('connect',()=>process.exit(0)).on('error',(e)=>{console.log(e.code);process.exit(3)})",
      upstream,
    );
    expect(probe.exitCode).toBe(3);
    await runtime.release('offline');
  }, 120_000);

  it('reaches only allowlisted destinations through the per-run proxy and reports denials', async () => {
    const runtime = createRuntime();
    const descriptor = await prepare(runtime, 'egress', { egress: [`${upstream}:8443`] });
    expect(descriptor.appliedLimits.container?.network).toBe('egress-proxy');

    const allowed = await exec(runtime, 'egress', 'node', '-e', CONNECT_SCRIPT, `${upstream}:8443`);
    expect(allowed.stdout).toContain('200 Connection Established');
    expect(allowed.stdout).toContain('HELLO');

    const denied = await exec(runtime, 'egress', 'node', '-e', CONNECT_SCRIPT, `${upstream}:9999`);
    expect(denied.stdout).toContain('403');
    const direct = await exec(
      runtime,
      'egress',
      'node',
      '-e',
      "require('node:net').connect(8443, process.argv[1]).on('connect',()=>process.exit(0)).on('error',()=>process.exit(3))",
      upstream,
    );
    expect(direct.exitCode).toBe(3);

    const report = await runtime.release('egress');
    expect(report?.deniedEgress).toEqual([`${upstream}:9999`]);
    expect(ownedContainers()).toEqual([]);
  }, 120_000);

  it('enforces memory, pid and tmpfs limits', async () => {
    const runtime = createRuntime();
    await prepare(runtime, 'limits');

    const disk = await exec(runtime, 'limits', 'sh', '-c', 'head -c 40000000 /dev/zero > /tmp/big');
    expect(disk.exitCode).not.toBe(0);
    expect(disk.stderr).toMatch(/no space/iu);

    const memory = await exec(
      runtime,
      'limits',
      'node',
      '-e',
      'const a=[];for(;;)a.push(Buffer.alloc(4e6,1))',
    );
    expect(memory.exitCode).toBe(137);

    // Last: the forked sleeps hold the pid budget until they exit.
    const pids = await exec(
      runtime,
      'limits',
      'sh',
      '-c',
      'for i in $(seq 1 100); do sleep 5 & done; wait',
    );
    expect(`${pids.stdout}${pids.stderr}`).toMatch(/fork|resource/iu);
    const report = await runtime.release('limits');
    expect(report?.exitReason).toBe('MEMORY_LIMIT');
  }, 120_000);

  it('kills every agent process on timeout and on cancellation', async () => {
    const runtime = createRuntime();
    await prepare(runtime, 'timeout', { timeoutMs: 1_500 });
    await expect(exec(runtime, 'timeout', 'sleep', '30')).rejects.toMatchObject({
      name: 'CommandTimeoutError',
    });
    expect((await runtime.release('timeout'))?.exitReason).toBe('TIMEOUT');

    await prepare(runtime, 'cancel');
    const running = exec(runtime, 'cancel', 'sleep', '30');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await runtime.cancel('cancel');
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect((await runtime.release('cancel'))?.exitReason).toBe('CANCELLED');
    expect(ownedContainers()).toEqual([]);
  }, 120_000);

  it('reaps containers a crashed worker left behind, and only its own', async () => {
    const crashed = createRuntime();
    await prepare(crashed, 'orphan', { egress: [`${upstream}:8443`] });
    expect(ownedContainers()).toHaveLength(2);
    const other = createRuntime({ owner: `${owner}-other` });
    await prepare(other, 'unrelated');

    const restarted = createRuntime();
    expect(await restarted.recover()).toBe(2);
    expect(ownedContainers()).toEqual([]);
    expect(
      docker(
        'ps',
        '--filter',
        `label=engloop.owner=${owner}-other`,
        '--format',
        '{{.Names}}',
      ).stdout.trim(),
    ).not.toBe('');
    await other.release('unrelated');
  }, 120_000);

  it('fails closed when the sandbox cannot start or would need host CLI logins', async () => {
    const missing = createRuntime({ image: 'engloop/does-not-exist:never' });
    await expect(prepare(missing, 'missing')).rejects.toBeInstanceOf(SandboxUnavailableError);

    const runtime = createRuntime();
    await expect(
      runtime.prepare({
        runId: 'login',
        workspacePath: worktree,
        limits: { timeoutMs: 1_000, allowedCommands: ['sh'] },
        secretEnv: {},
        credentialSource: 'cli-login',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
    expect(ownedContainers()).toEqual([]);
  }, 120_000);

  it('runs health probes in a throwaway, offline container', async () => {
    const runtime = createRuntime();
    const result = await runtime.run({
      scope: 'health',
      command: '/usr/local/bin/node',
      args: ['--version'],
      cwd: root,
      label: 'health',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v22\./u);
    expect(ownedContainers()).toEqual([]);
  }, 60_000);
});
