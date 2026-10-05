import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AgentCommandInput } from '@engloop/agent-sdk';
import type { CommandRunner, RunCommandInput } from '@engloop/git';
import type { CommandResult } from '@engloop/types';
import type {
  AgentExecutionRuntime,
  DockerContainerRuntimeDescriptor,
  PrepareExecutionInput,
} from './execution-runtime';

const CONTAINER_WORKSPACE = '/workspace';
const CONTAINER_CONTROL = '/engloop-control';
const API_KEY_ENV_NAMES = new Set(['ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'OPENAI_API_KEY']);

interface DockerSession {
  descriptor: DockerContainerRuntimeDescriptor;
  allowedCommands: ReadonlySet<string>;
  secretEnv: Record<string, string>;
  executionEnv: Record<string, string>;
  controlDirectory: string;
  controller: AbortController;
  removed: boolean;
  removalPromise: Promise<void> | null;
  invocationDirectories: string[];
  paused: boolean;
  executing: boolean;
}

export interface DockerContainerExecutionRuntimeOptions {
  runner: CommandRunner;
  dockerRunner: CommandRunner;
  dockerCommand: string;
  image: string;
  controlRoot: string;
  cpuCount: number;
  memoryBytes: number;
  pids: number;
}

const commandNames = (command: string): string[] => {
  const normalized = command.replace(/\\/gu, '/');
  return [command, normalized.slice(normalized.lastIndexOf('/') + 1)];
};

const normalizePath = (value: string): string => {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const containsPath = (parent: string, child: string): boolean => {
  const path = relative(normalizePath(parent), normalizePath(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

const containerPath = (root: string, relativePath: string): string => {
  const suffix = relativePath.split(sep).filter(Boolean).join('/');
  return suffix ? `${root}/${suffix}` : root;
};

const safeNamePart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '-')
    .replace(/^[^a-z0-9]+/gu, '')
    .slice(0, 24) || 'run';

/**
 * Runs each provider invocation in one Docker container with no network and a
 * private copy of Git metadata. The repository store backing a linked worktree
 * is deliberately never mounted.
 */
export class DockerContainerExecutionRuntime implements AgentExecutionRuntime {
  private readonly sessions = new Map<string, DockerSession>();
  private state: 'running' | 'shutting-down' | 'closed' = 'running';
  private shutdownPromise: Promise<void> | null = null;
  private readonly preparations = new Map<string, Promise<DockerContainerRuntimeDescriptor>>();

  constructor(private readonly options: DockerContainerExecutionRuntimeOptions) {}

  isAllowed(command: string): boolean {
    return (
      this.options.dockerRunner.isAllowed(this.options.dockerCommand) &&
      this.options.runner.isAllowed(command)
    );
  }

  prepare(input: PrepareExecutionInput): Promise<DockerContainerRuntimeDescriptor> {
    if (
      this.state !== 'running' ||
      this.preparations.has(input.runId) ||
      this.sessions.has(input.runId)
    ) {
      return Promise.reject(new Error('Runtime is closed or run is already prepared'));
    }
    const preparation = this.prepareSession(input).finally(() =>
      this.preparations.delete(input.runId),
    );
    this.preparations.set(input.runId, preparation);
    return preparation;
  }

  private async prepareSession(
    input: PrepareExecutionInput,
  ): Promise<DockerContainerRuntimeDescriptor> {
    if (this.state !== 'running') throw new Error(`Execution runtime is ${this.state}`);
    if (this.sessions.has(input.runId)) {
      throw new Error(`Execution runtime is already prepared for run ${input.runId}`);
    }
    if (input.credentialSource !== 'api-key') {
      throw new Error(
        'Docker agent execution requires a stored API key; host CLI login state is not mounted',
      );
    }
    if (!this.options.dockerRunner.isAllowed(this.options.dockerCommand)) {
      throw new Error(`Docker command "${this.options.dockerCommand}" is not in COMMAND_ALLOWLIST`);
    }
    if (!this.options.runner.isAllowed('git')) {
      throw new Error('git is required in COMMAND_ALLOWLIST to create isolated Git metadata');
    }

    const workspacePath = resolve(input.workspacePath);
    const controlRoot = resolve(this.options.controlRoot);
    if (containsPath(workspacePath, controlRoot) || containsPath(controlRoot, workspacePath)) {
      throw new Error('Runtime control root and assigned worktree must not overlap');
    }
    const gitFile = join(workspacePath, '.git');
    const gitFileStat = await lstat(gitFile).catch(() => null);
    if (!gitFileStat?.isFile()) {
      throw new Error('Docker execution requires an assigned linked Git worktree with a .git file');
    }
    const linkedGit = (await readFile(gitFile, 'utf8')).trim();
    if (!linkedGit.startsWith('gitdir:')) {
      throw new Error('Assigned worktree .git file does not contain a linked-worktree gitdir');
    }

    const runtimeId = `docker-${randomUUID()}`;
    const containerName = `engloop-agent-${safeNamePart(input.runId)}-${randomUUID().slice(0, 12)}`;
    const controlDirectory = join(controlRoot, runtimeId);
    const shadowCheckout = join(controlDirectory, 'git-shadow');
    const shadowGitFile = join(controlDirectory, 'workspace.git');
    const runtimeHome = join(controlDirectory, 'home');
    const secretEnv: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.secretEnv)) {
      if (API_KEY_ENV_NAMES.has(name)) secretEnv[name] = value;
    }
    if (Object.keys(secretEnv).length === 0) {
      throw new Error(
        'Docker agent execution did not receive a supported provider API-key environment variable',
      );
    }

    await Promise.all([
      mkdir(controlDirectory, { recursive: true }),
      mkdir(runtimeHome, { recursive: true }),
      mkdir(join(controlDirectory, 'invocations'), { recursive: true }),
    ]);
    const descriptor: DockerContainerRuntimeDescriptor = {
      runtimeId,
      kind: 'DOCKER_CONTAINER',
      isolated: true,
      containerName,
      workspacePath,
      startedAt: new Date().toISOString(),
      appliedLimits: {
        timeoutMs: input.limits.timeoutMs,
        allowedCommands: [...input.limits.allowedCommands],
        cpuCount: this.options.cpuCount,
        memoryBytes: this.options.memoryBytes,
        pids: this.options.pids,
        network: 'none',
      },
      credentialSource: input.credentialSource,
    };
    const session: DockerSession = {
      descriptor,
      allowedCommands: new Set(input.limits.allowedCommands.flatMap(commandNames)),
      secretEnv,
      executionEnv: {
        ...secretEnv,
        HOME: `${CONTAINER_CONTROL}/home`,
        TMPDIR: '/tmp',
        XDG_CACHE_HOME: `${CONTAINER_CONTROL}/home/.cache`,
        XDG_CONFIG_HOME: `${CONTAINER_CONTROL}/home/.config`,
      },
      controlDirectory,
      controller: new AbortController(),
      removed: false,
      removalPromise: null,
      invocationDirectories: [],
      paused: false,
      executing: false,
    };

    this.sessions.set(input.runId, session);
    try {
      if (this.state !== 'running') throw new Error('Runtime is shutting down');
      await this.runHost({
        command: 'git',
        args: ['clone', '--no-hardlinks', '--no-checkout', '--', workspacePath, shadowCheckout],
        cwd: controlDirectory,
        throwOnFailure: true,
        label: 'agent git metadata shadow',
      });
      await this.runHost({
        command: 'git',
        args: ['--git-dir', join(shadowCheckout, '.git'), 'read-tree', 'HEAD'],
        cwd: workspacePath,
        throwOnFailure: true,
        label: 'agent git metadata index',
      });
      await this.runHost({
        command: 'git',
        args: ['--git-dir', join(shadowCheckout, '.git'), 'remote', 'remove', 'origin'],
        cwd: controlDirectory,
        throwOnFailure: true,
      });
      await this.runHost({
        command: 'git',
        args: [
          '--git-dir',
          join(shadowCheckout, '.git'),
          'config',
          'core.worktree',
          CONTAINER_WORKSPACE,
        ],
        cwd: controlDirectory,
        throwOnFailure: true,
      });
      if (session.controller.signal.aborted || this.state !== 'running')
        throw new Error('Runtime preparation cancelled');
      await writeFile(shadowGitFile, `gitdir: ${CONTAINER_CONTROL}/git-shadow/.git\n`, 'utf8');

      const createResult = await this.runDocker(
        [
          'create',
          '--name',
          containerName,
          '--label',
          'engloop.managed=true',
          '--label',
          `engloop.run-id=${input.runId}`,
          '--label',
          `engloop.runtime-id=${runtimeId}`,
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
          String(this.options.cpuCount),
          '--memory',
          String(this.options.memoryBytes),
          '--pids-limit',
          String(this.options.pids),
          '--workdir',
          CONTAINER_WORKSPACE,
          '--mount',
          `type=bind,source=${workspacePath},target=${CONTAINER_WORKSPACE}`,
          '--mount',
          `type=bind,source=${controlDirectory},target=${CONTAINER_CONTROL}`,
          '--mount',
          `type=bind,source=${shadowGitFile},target=${CONTAINER_WORKSPACE}/.git,readonly`,
          this.options.image,
          'tail',
          '-f',
          '/dev/null',
        ],
        controlDirectory,
        undefined,
        undefined,
        true,
        'agent container create',
      );
      if (createResult.exitCode !== 0) throw new Error('Docker container creation failed');
      await this.runDocker(
        ['start', containerName],
        controlDirectory,
        undefined,
        undefined,
        true,
        'agent container start',
      );
      if (session.controller.signal.aborted || this.state !== 'running')
        throw new Error('Runtime preparation cancelled');
      await this.pause(session);
      return descriptor;
    } catch (error) {
      session.controller.abort();
      const redactions = Object.values(session.secretEnv).filter(Boolean);
      this.clearSecrets(session);
      try {
        await this.forceRemove(session);
      } catch (cleanupError) {
        throw new Error(
          this.scrub(
            redactions,
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          ),
        );
      }
      this.sessions.delete(input.runId);
      await rm(controlDirectory, { recursive: true, force: true });
      throw new Error(
        this.scrub(redactions, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  async createInvocationDirectory(runId: string): Promise<string> {
    const session = this.sessions.get(runId);
    if (!session) throw new Error(`Execution runtime is not prepared for run ${runId}`);
    if (session.executing || session.controller.signal.aborted || session.removed)
      throw new Error('Runtime is executing or cancelled');
    await this.pause(session);
    await this.assertSafeDirectory(session.controlDirectory);
    const invocations = join(session.controlDirectory, 'invocations');
    await this.assertSafeDirectory(invocations);
    const directory = join(session.controlDirectory, 'invocations', randomUUID());
    await mkdir(directory, { recursive: true });
    session.invocationDirectories.push(directory);
    return directory;
  }

  async run(input: AgentCommandInput): Promise<CommandResult> {
    if (this.state !== 'running') throw new Error(`Execution runtime is ${this.state}`);
    if (input.scope === 'health') {
      const healthName = `engloop-health-${randomUUID()}`;
      await mkdir(this.options.controlRoot, { recursive: true });
      try {
        return await this.runDocker(
          [
            'run',
            '--rm',
            '--name',
            healthName,
            '--label',
            'engloop.managed=true',
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
            String(this.options.cpuCount),
            '--memory',
            String(this.options.memoryBytes),
            '--pids-limit',
            String(this.options.pids),
            this.options.image,
            input.command,
            ...input.args,
          ],
          this.options.controlRoot,
          input.signal,
          undefined,
          false,
          input.label,
          input.timeoutMs,
        );
      } finally {
        const removal = await this.runDocker(
          ['rm', '--force', healthName],
          this.options.controlRoot,
        );
        this.assertRemoved(removal);
      }
    }

    const session = this.sessions.get(input.runId);
    if (!session) throw new Error(`Execution runtime is not prepared for run ${input.runId}`);
    if (session.controller.signal.aborted || session.removed)
      throw new Error('Runtime is cancelled');
    if (session.executing) throw new Error('Runtime is already executing');
    if (!containsPath(session.descriptor.workspacePath, input.cwd)) {
      throw new Error(`Command cwd is outside the registered worktree for run ${input.runId}`);
    }
    if (
      !this.options.runner.isAllowed(input.command) ||
      !commandNames(input.command).some((name) => session.allowedCommands.has(name))
    ) {
      throw new Error(`Command "${input.command}" is not allowed for run ${input.runId}`);
    }

    const controller = new AbortController();
    const abort = (): void => controller.abort();
    session.controller.signal.addEventListener('abort', abort, { once: true });
    input.signal?.addEventListener('abort', abort, { once: true });
    if (session.controller.signal.aborted || input.signal?.aborted) controller.abort();

    const executionCwd = containerPath(
      CONTAINER_WORKSPACE,
      relative(session.descriptor.workspacePath, resolve(input.cwd)),
    );
    const translatedArgs = input.args.map((argument) => this.translateArgument(session, argument));
    const envArgs = Object.keys(session.executionEnv)
      .sort()
      .flatMap((name) => ['--env', name]);
    const timeoutMs = Math.min(
      input.timeoutMs ?? session.descriptor.appliedLimits.timeoutMs,
      session.descriptor.appliedLimits.timeoutMs,
    );
    const redactions = Object.values(session.secretEnv).filter(Boolean);

    session.executing = true;
    try {
      if (session.paused) {
        await this.runDocker(
          ['unpause', session.descriptor.containerName],
          session.controlDirectory,
          undefined,
          undefined,
          true,
        );
        session.paused = false;
      }
      const result = await this.runDocker(
        [
          'exec',
          '-i',
          '--workdir',
          executionCwd,
          ...envArgs,
          session.descriptor.containerName,
          input.command,
          ...translatedArgs,
        ],
        session.controlDirectory,
        controller.signal,
        session.executionEnv,
        false,
        input.label,
        timeoutMs,
        this.translateRequest(session, input.stdin),
      );
      await this.pause(session);
      await this.assertSafeDirectory(session.controlDirectory);
      const activeDirectories: string[] = [];
      for (const directory of session.invocationDirectories) {
        const parent = join(session.controlDirectory, 'invocations');
        const parentStat = await lstat(parent).catch(() => null);
        if (!parentStat) throw new Error('Invalid provider invocation directory');
        await this.assertSafeDirectory(parent);
        const directoryStat = await lstat(directory).catch(() => null);
        if (!directoryStat) continue;
        await this.assertSafeDirectory(directory);
        activeDirectories.push(directory);
        const outputPath = join(directory, 'output.json');
        const stat = await lstat(outputPath).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink())
          throw new Error('Invalid provider output file');
        if (stat.size > 16 * 1024 * 1024) throw new Error('Provider output file exceeds 16 MiB');
        const output = await readFile(outputPath, 'utf8');
        await writeFile(outputPath, this.scrub(redactions, output), 'utf8');
      }
      session.invocationDirectories = activeDirectories;
      return {
        ...result,
        command: input.command,
        args: translatedArgs,
        cwd: executionCwd,
        stdout: this.scrub(redactions, result.stdout),
        stderr: this.scrub(redactions, result.stderr),
      };
    } catch (error) {
      // Killing the Docker client alone leaves exec processes running in the container.
      session.controller.abort();
      try {
        await this.forceRemove(session);
      } catch (cleanupError) {
        throw new Error(
          this.scrub(
            redactions,
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          ),
        );
      }
      const safeError = new Error(
        this.scrub(redactions, error instanceof Error ? error.message : String(error)),
      );
      safeError.name = error instanceof Error ? error.name : 'Error';
      throw safeError;
    } finally {
      session.executing = false;
      session.controller.signal.removeEventListener('abort', abort);
      input.signal?.removeEventListener('abort', abort);
    }
  }

  private async assertSafeDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Invalid provider invocation directory');
  }

  private async pause(session: DockerSession): Promise<void> {
    if (session.paused) return;
    await this.runDocker(
      ['pause', session.descriptor.containerName],
      session.controlDirectory,
      undefined,
      undefined,
      true,
    );
    session.paused = true;
  }

  async cancel(runId: string): Promise<void> {
    if (this.preparations.has(runId)) {
      this.sessions.get(runId)?.controller.abort();
      await this.preparations.get(runId)?.catch(() => undefined);
    }
    const session = this.sessions.get(runId);
    if (!session) return;
    session.controller.abort();
    await this.forceRemove(session);
  }

  async release(runId: string): Promise<void> {
    await this.preparations.get(runId)?.catch(() => undefined);
    const session = this.sessions.get(runId);
    if (!session) return;
    session.controller.abort();
    this.clearSecrets(session);
    await this.forceRemove(session);
    this.sessions.delete(runId);
    await rm(session.controlDirectory, { recursive: true, force: true });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.state = 'shutting-down';
    for (const session of this.sessions.values()) session.controller.abort();
    this.shutdownPromise = Promise.allSettled([...this.preparations.values()])
      .then(() =>
        Promise.all(
          [...this.sessions.entries()].map(async ([runId, session]) => {
            session.controller.abort();
            this.clearSecrets(session);
            await this.forceRemove(session);
            this.sessions.delete(runId);
            await rm(session.controlDirectory, { recursive: true, force: true });
          }),
        ),
      )
      .then(() => {
        this.state = 'closed';
      });
    return this.shutdownPromise;
  }

  private translateArgument(session: DockerSession, argument: string): string {
    if (!isAbsolute(argument)) return argument;
    const absolute = resolve(argument);
    if (containsPath(session.descriptor.workspacePath, absolute)) {
      return containerPath(
        CONTAINER_WORKSPACE,
        relative(session.descriptor.workspacePath, absolute),
      );
    }
    if (containsPath(session.controlDirectory, absolute)) {
      return containerPath(CONTAINER_CONTROL, relative(session.controlDirectory, absolute));
    }
    return argument;
  }

  private translateRequest(_session: DockerSession, stdin?: string): string | undefined {
    if (!stdin) return stdin;
    const request: unknown = JSON.parse(stdin);
    if (typeof request === 'object' && request !== null && 'repository' in request) {
      const repository = request.repository;
      if (typeof repository === 'object' && repository !== null && 'rootPath' in repository)
        repository.rootPath = CONTAINER_WORKSPACE;
    }
    return JSON.stringify(request);
  }

  private scrub(values: readonly string[], text: string): string {
    for (const value of values) {
      if (value) text = text.split(value).join('[REDACTED]');
    }
    return text;
  }

  private assertRemoved(result: CommandResult): void {
    if (result.exitCode !== 0 && !/no such container/iu.test(result.stderr)) {
      throw new Error('Health container cleanup failed');
    }
  }

  private async forceRemove(session: DockerSession): Promise<void> {
    if (session.removed) return;
    session.removalPromise ??= this.runDocker(
      ['rm', '--force', session.descriptor.containerName],
      session.controlDirectory,
      undefined,
      undefined,
      false,
      'agent container remove',
      30_000,
    ).then((result) => {
      if (result.exitCode !== 0 && !/no such container/iu.test(result.stderr)) {
        throw new Error(result.stderr.trim() || 'Docker container removal failed');
      }
      session.removed = true;
    });
    try {
      await session.removalPromise;
    } catch (error) {
      session.removalPromise = null;
      throw error;
    }
  }

  private clearSecrets(session: DockerSession): void {
    for (const name of Object.keys(session.secretEnv)) session.secretEnv[name] = '';
    for (const name of API_KEY_ENV_NAMES) {
      if (name in session.executionEnv) session.executionEnv[name] = '';
    }
  }

  private runHost(input: RunCommandInput): Promise<CommandResult> {
    return this.options.runner.run(input);
  }

  private runDocker(
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
    env?: Record<string, string>,
    throwOnFailure = false,
    label?: string,
    timeoutMs?: number,
    stdin?: string,
  ): Promise<CommandResult> {
    return this.options.dockerRunner.run({
      command: this.options.dockerCommand,
      args,
      cwd,
      signal,
      env,
      throwOnFailure,
      label,
      timeoutMs,
      stdin,
    });
  }
}
