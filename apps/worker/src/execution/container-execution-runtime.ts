import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { AgentCommandInput } from '@engloop/agent-sdk';
import { CommandTimeoutError, type RunCommandInput } from '@engloop/git';
import { silentLogger, type EngLoopLogger } from '@engloop/logger';
import type { CommandResult } from '@engloop/types';
import type {
  AgentExecutionRuntime,
  ExecutionExitReason,
  ExecutionRuntimeDescriptor,
  ExecutionRuntimeReport,
  PrepareExecutionInput,
} from './execution-runtime';
import {
  CONTAINER_SCRATCH,
  CONTAINER_WORKSPACE,
  LABEL_OWNER,
  agentContainerArgs,
  containerSafeId,
  containsPath,
  execArgs,
  healthContainerArgs,
  parseSandboxUser,
  proxyContainerArgs,
  toContainerPath,
  type ContainerLimits,
  type SandboxUser,
} from './container-args';
import { normalizeEgressAllowlist, parseDeniedEgress } from './egress-policy';

export interface ContainerRuntimeConfig extends ContainerLimits {
  dockerPath: string;
  image: string;
  /** Image for the egress proxy; needs only `node`. */
  proxyImage: string;
  /** `uid:gid` the agent runs as. uid 0 is refused. */
  user: string;
  /** Identifies this worker's containers so recovery never touches another worker's. */
  owner: string;
  /** Host directory holding per-run scratch mounts. Never inside a worktree. */
  scratchRoot: string;
  /** Destinations every run may reach, on top of the per-run list. */
  egressAllowlist: readonly string[];
  /** Network the egress proxy uses to reach allowlisted destinations. */
  egressNetwork: string;
  /** Global executable allowlist; a run's own list is intersected with it. */
  commandAllowlist: readonly string[];
}

export interface DockerCommandRunner {
  run(input: RunCommandInput): Promise<CommandResult>;
}

export interface ContainerExecutionRuntimeOptions {
  runner: DockerCommandRunner;
  config: ContainerRuntimeConfig;
  logger?: EngLoopLogger;
}

/** The sandbox could not be created. The run fails; it never falls back to the host. */
export class SandboxUnavailableError extends Error {
  readonly code = 'AGENT_SANDBOX_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}

interface ContainerSession {
  runId: string;
  descriptor: ExecutionRuntimeDescriptor;
  container: string;
  proxy: string | null;
  network: string | null;
  scratchDir: string;
  allowedCommands: ReadonlySet<string>;
  secretEnv: Readonly<Record<string, string>>;
  controller: AbortController;
  exitReason: ExecutionExitReason;
  deadlineAt: number;
  deadline: NodeJS.Timeout | null;
  killing: Promise<void> | null;
}

const DOCKER_TIMEOUT_MS = 60_000;
const PROXY_READY_TIMEOUT_MS = 10_000;

const commandNames = (command: string): string[] => {
  const normalized = command.replace(/\\/gu, '/');
  return [command, normalized.slice(normalized.lastIndexOf('/') + 1)];
};

const errorName = (error: unknown): string | undefined =>
  error instanceof Error ? error.name : undefined;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * One locked-down container per agent run.
 *
 * The container sees only the run's worktree and a per-run scratch directory,
 * runs as a non-root user on a read-only image with no capabilities, and is
 * capped on CPU, memory (no swap), PIDs and tmpfs size. Without an egress
 * allowlist it has no network at all; with one, its only route out is a per-run
 * proxy that tunnels allowlisted `host:port` pairs. Cancellation, timeout and
 * shutdown kill the container, which ends every process the agent started.
 */
export class ContainerExecutionRuntime implements AgentExecutionRuntime {
  readonly kind = 'CONTAINER' as const;
  private readonly sessions = new Map<string, ContainerSession>();
  private readonly logger: EngLoopLogger;
  private readonly user: SandboxUser;
  private state: 'running' | 'shutting-down' | 'closed' = 'running';
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: ContainerExecutionRuntimeOptions) {
    this.logger = options.logger ?? silentLogger;
    this.user = parseSandboxUser(options.config.user);
    normalizeEgressAllowlist(options.config.egressAllowlist);
  }

  private get config(): ContainerRuntimeConfig {
    return this.options.config;
  }

  isAllowed(command: string): boolean {
    return commandNames(command).some((name) => this.config.commandAllowlist.includes(name));
  }

  invocationDirectory(runId: string): string | undefined {
    return this.sessions.get(runId)?.scratchDir;
  }

  async prepare(input: PrepareExecutionInput): Promise<ExecutionRuntimeDescriptor> {
    this.assertRunning();
    if (this.sessions.has(input.runId)) {
      throw new Error(`Execution runtime is already prepared for run ${input.runId}`);
    }
    if (input.credentialSource === 'cli-login') {
      // Host CLI login state lives outside the worktree; mounting it would hand the
      // agent a host credential file. Container runs need a stored API key.
      throw new SandboxUnavailableError(
        'The container runtime does not mount host CLI logins; configure an organization API key for this provider',
      );
    }

    const workspacePath = resolve(input.workspacePath);
    const workspace = await stat(workspacePath).catch(() => null);
    if (!workspace?.isDirectory()) {
      throw new SandboxUnavailableError(`Worktree ${workspacePath} does not exist`);
    }
    const egressAllowlist = normalizeEgressAllowlist([
      ...this.config.egressAllowlist,
      ...(input.limits.egressAllowlist ?? []),
    ]);

    const id = `${containerSafeId(input.runId)}-${randomUUID().slice(0, 8)}`;
    const scratchDir = join(resolve(this.config.scratchRoot), id);
    const session: ContainerSession = {
      runId: input.runId,
      descriptor: {
        runtimeId: `container-${id}`,
        kind: this.kind,
        isolated: true,
        workspacePath,
        startedAt: new Date().toISOString(),
        image: this.config.image,
        appliedLimits: {
          timeoutMs: input.limits.timeoutMs,
          allowedCommands: [...input.limits.allowedCommands],
          container: {
            cpus: this.config.cpus,
            memoryMb: this.config.memoryMb,
            pidsLimit: this.config.pidsLimit,
            tmpfsMb: this.config.tmpfsMb,
            readOnlyRootFs: true,
            network: egressAllowlist.length > 0 ? 'egress-proxy' : 'none',
            egressAllowlist,
          },
        },
        credentialSource: input.credentialSource,
      },
      container: `engloop-run-${id}`,
      proxy: egressAllowlist.length > 0 ? `engloop-egress-${id}` : null,
      network: egressAllowlist.length > 0 ? `engloop-net-${id}` : null,
      scratchDir,
      allowedCommands: new Set(input.limits.allowedCommands.flatMap(commandNames)),
      secretEnv: { ...input.secretEnv },
      controller: new AbortController(),
      exitReason: 'COMPLETED',
      deadlineAt: Date.now() + input.limits.timeoutMs,
      deadline: null,
      killing: null,
    };

    try {
      await mkdir(scratchDir, { recursive: true, mode: 0o700 });
      if (session.network && session.proxy) {
        await this.docker([
          'network',
          'create',
          '--internal',
          '--label',
          `${LABEL_OWNER}=${this.config.owner}`,
          session.network,
        ]);
        await this.docker(
          proxyContainerArgs({
            name: session.proxy,
            runId: input.runId,
            owner: this.config.owner,
            image: this.config.proxyImage,
            network: session.network,
            egressAllowlist,
          }),
        );
        await this.docker(['network', 'connect', this.config.egressNetwork, session.proxy]);
        await this.waitForProxy(session.proxy);
      }
      await this.docker(
        agentContainerArgs({
          name: session.container,
          runId: input.runId,
          owner: this.config.owner,
          image: this.config.image,
          user: this.user,
          limits: this.config,
          workspacePath,
          scratchPath: scratchDir,
          network: session.network,
          proxyHost: session.proxy,
        }),
      );
      await this.docker(['start', session.container]);
    } catch (error) {
      await this.destroy(session);
      const message = error instanceof Error ? error.message : String(error);
      throw new SandboxUnavailableError(`Agent sandbox failed to start: ${message}`);
    }

    if (this.state !== 'running') {
      await this.destroy(session);
      throw new Error(`Execution runtime is ${this.state}`);
    }

    session.deadline = setTimeout(() => {
      if (session.exitReason === 'COMPLETED') session.exitReason = 'TIMEOUT';
      session.controller.abort();
      void this.kill(session);
    }, input.limits.timeoutMs);
    session.deadline.unref?.();
    this.sessions.set(input.runId, session);
    return session.descriptor;
  }

  async run(input: AgentCommandInput): Promise<CommandResult> {
    this.assertRunning();
    if (input.scope === 'health') return this.runHealth(input);

    const session = this.sessions.get(input.runId);
    if (!session) throw new Error(`Execution runtime is not prepared for run ${input.runId}`);
    const mounts = [
      [session.descriptor.workspacePath, CONTAINER_WORKSPACE],
      [session.scratchDir, CONTAINER_SCRATCH],
    ] as const;
    if (!containsPath(session.descriptor.workspacePath, input.cwd)) {
      throw new Error(`Command cwd is outside the registered worktree for run ${input.runId}`);
    }
    if (
      !this.isAllowed(input.command) ||
      !commandNames(input.command).some((name) => session.allowedCommands.has(name))
    ) {
      throw new Error(`Command "${input.command}" is not allowed for run ${input.runId}`);
    }

    const limitMs = session.descriptor.appliedLimits.timeoutMs;
    const remainingMs = session.deadlineAt - Date.now();
    if (remainingMs <= 0 || session.exitReason === 'TIMEOUT') {
      throw new CommandTimeoutError(input.command, limitMs);
    }

    const controller = new AbortController();
    const abort = (): void => controller.abort();
    session.controller.signal.addEventListener('abort', abort, { once: true });
    input.signal?.addEventListener('abort', abort, { once: true });
    if (session.controller.signal.aborted || input.signal?.aborted) controller.abort();

    try {
      const result = await this.options.runner.run({
        command: this.config.dockerPath,
        args: execArgs({
          container: session.container,
          cwd: toContainerPath(mounts, input.cwd),
          envNames: Object.keys(session.secretEnv),
          // Host CLI paths mean nothing inside the image; resolve the name on its PATH.
          command: basename(input.command.replace(/\\/gu, '/')),
          args: input.args.map((arg) => toContainerPath(mounts, arg)),
        }),
        cwd: session.scratchDir,
        stdin: input.stdin,
        env: { ...session.secretEnv },
        signal: controller.signal,
        timeoutMs: Math.min(input.timeoutMs ?? limitMs, limitMs, remainingMs),
        label: input.label,
      });
      if (result.exitCode === 137 && (await this.oomKilled(session))) {
        session.exitReason = 'MEMORY_LIMIT';
      }
      return { ...result, command: input.command, args: [...input.args], cwd: input.cwd };
    } catch (error) {
      if (errorName(error) === 'CommandTimeoutError' && session.exitReason === 'COMPLETED') {
        session.exitReason = 'TIMEOUT';
      } else if (errorName(error) === 'AbortError' && session.exitReason === 'COMPLETED') {
        session.exitReason = 'CANCELLED';
      }
      // The docker client dying does not stop the process inside the container.
      await this.kill(session);
      if (session.exitReason === 'TIMEOUT') throw new CommandTimeoutError(input.command, limitMs);
      throw error;
    } finally {
      session.controller.signal.removeEventListener('abort', abort);
      input.signal?.removeEventListener('abort', abort);
    }
  }

  async cancel(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    if (session.exitReason === 'COMPLETED') session.exitReason = 'CANCELLED';
    session.controller.abort();
    await this.kill(session);
  }

  async release(runId: string): Promise<ExecutionRuntimeReport | null> {
    const session = this.sessions.get(runId);
    if (!session) return null;
    this.sessions.delete(runId);
    if (session.deadline) clearTimeout(session.deadline);
    session.controller.abort();

    const resourceUsage = await this.resourceUsage(session);
    if (session.exitReason === 'COMPLETED' && (await this.oomKilled(session))) {
      session.exitReason = 'MEMORY_LIMIT';
    }
    const deniedEgress = session.proxy ? await this.deniedEgress(session.proxy) : [];
    await this.destroy(session);
    return {
      runtimeId: session.descriptor.runtimeId,
      kind: this.kind,
      exitReason: session.exitReason,
      deniedEgress,
      ...(resourceUsage ? { resourceUsage } : {}),
    };
  }

  async recover(): Promise<number> {
    const active = new Set(
      [...this.sessions.values()].flatMap((session) =>
        [session.container, session.proxy, session.network].filter(
          (name): name is string => name !== null,
        ),
      ),
    );
    const owned = `label=${LABEL_OWNER}=${this.config.owner}`;
    const containers = (
      await this.docker(['ps', '--all', '--filter', owned, '--format', '{{.Names}}'])
    )
      .split(/\s+/u)
      .filter((name) => name && !active.has(name));
    if (containers.length > 0) await this.docker(['rm', '--force', ...containers]);

    const networks = (
      await this.docker(['network', 'ls', '--filter', owned, '--format', '{{.Name}}'])
    )
      .split(/\s+/u)
      .filter((name) => name && !active.has(name));
    if (networks.length > 0) await this.docker(['network', 'rm', ...networks]);

    const scratchRoot = resolve(this.config.scratchRoot);
    const activeScratch = new Set([...this.sessions.values()].map((session) => session.scratchDir));
    if (activeScratch.size === 0) {
      await rm(scratchRoot, { recursive: true, force: true });
    }
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });

    if (containers.length > 0) {
      this.logger.warn({ containers, networks }, 'agent.runtime.orphans_removed');
    }
    return containers.length;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.state = 'shutting-down';
    this.shutdownPromise = (async () => {
      const sessions = [...this.sessions.values()];
      for (const session of sessions) {
        if (session.exitReason === 'COMPLETED') session.exitReason = 'SHUTDOWN';
        session.controller.abort();
      }
      await Promise.all(sessions.map((session) => this.release(session.runId)));
      this.state = 'closed';
    })();
    return this.shutdownPromise;
  }

  private assertRunning(): void {
    if (this.state !== 'running') throw new Error(`Execution runtime is ${this.state}`);
  }

  private async runHealth(input: AgentCommandInput): Promise<CommandResult> {
    if (!this.isAllowed(input.command)) {
      throw new Error(`Command "${input.command}" is not allowed`);
    }
    const result = await this.options.runner.run({
      command: this.config.dockerPath,
      args: healthContainerArgs({
        owner: this.config.owner,
        image: this.config.image,
        user: this.user,
        limits: this.config,
        command: basename(input.command.replace(/\\/gu, '/')),
        args: input.args,
      }),
      cwd: resolve(this.config.scratchRoot),
      stdin: input.stdin,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? DOCKER_TIMEOUT_MS,
      label: input.label,
    });
    return { ...result, command: input.command, args: [...input.args], cwd: input.cwd };
  }

  private async docker(args: string[], timeoutMs = DOCKER_TIMEOUT_MS): Promise<string> {
    await mkdir(resolve(this.config.scratchRoot), { recursive: true, mode: 0o700 });
    const result = await this.options.runner.run({
      command: this.config.dockerPath,
      args,
      cwd: resolve(this.config.scratchRoot),
      timeoutMs,
      label: `docker ${args[0] ?? ''}`,
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `exit code ${String(result.exitCode)}`;
      throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${detail}`);
    }
    return result.stdout.trim();
  }

  private async tryDocker(args: string[], timeoutMs = DOCKER_TIMEOUT_MS): Promise<string | null> {
    try {
      return await this.docker(args, timeoutMs);
    } catch {
      return null;
    }
  }

  private async waitForProxy(proxy: string): Promise<void> {
    const deadline = Date.now() + PROXY_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const running = await this.tryDocker(['inspect', '--format', '{{.State.Running}}', proxy]);
      if (running === 'false') throw new Error('egress proxy exited during startup');
      const listening = await this.tryDocker([
        'exec',
        proxy,
        'node',
        '-e',
        "require('node:net').connect(Number(process.env.ENGLOOP_EGRESS_PORT),'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))",
      ]);
      if (listening !== null) return;
      await sleep(100);
    }
    throw new Error('egress proxy did not start listening in time');
  }

  private kill(session: ContainerSession): Promise<void> {
    session.killing ??= this.tryDocker(['kill', session.container]).then(() => undefined);
    return session.killing;
  }

  private async oomKilled(session: ContainerSession): Promise<boolean> {
    const value = await this.tryDocker([
      'inspect',
      '--format',
      '{{.State.OOMKilled}}',
      session.container,
    ]);
    return value === 'true';
  }

  private async resourceUsage(
    session: ContainerSession,
  ): Promise<ExecutionRuntimeReport['resourceUsage'] | null> {
    const output = await this.tryDocker(
      [
        'exec',
        session.container,
        'cat',
        '/sys/fs/cgroup/memory.peak',
        '/sys/fs/cgroup/memory.events',
      ],
      5_000,
    );
    if (!output) return null;
    const [peak] = output.split(/\r?\n/u);
    const oomKills = /^oom_kill (\d+)$/mu.exec(output)?.[1];
    return {
      ...(peak && /^\d+$/u.test(peak) ? { memoryPeakBytes: Number(peak) } : {}),
      ...(oomKills ? { oomKills: Number(oomKills) } : {}),
    };
  }

  private async deniedEgress(proxy: string): Promise<string[]> {
    const logs = await this.tryDocker(['logs', proxy]);
    return logs ? parseDeniedEgress(logs) : [];
  }

  private async destroy(session: ContainerSession): Promise<void> {
    const containers = [session.container, session.proxy].filter(
      (name): name is string => name !== null,
    );
    const removed = await this.tryDocker(['rm', '--force', ...containers]);
    const networkRemoved = session.network
      ? await this.tryDocker(['network', 'rm', session.network])
      : '';
    await rm(session.scratchDir, { recursive: true, force: true }).catch(() => undefined);
    if (removed === null || networkRemoved === null) {
      // Left for recover(); never treated as a reason to keep the run alive.
      this.logger.warn({ runId: session.runId, containers }, 'agent.runtime.cleanup_incomplete');
    }
  }
}
