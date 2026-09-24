import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentCommandInput } from '@engloop/agent-sdk';
import type { CommandRunner } from '@engloop/git';
import type { CommandResult } from '@engloop/types';
import type {
  AgentExecutionRuntime,
  ExecutionRuntimeDescriptor,
  PrepareExecutionInput,
} from './execution-runtime';

interface HostProcessSession {
  descriptor: ExecutionRuntimeDescriptor;
  allowedCommands: ReadonlySet<string>;
  secretEnv: Readonly<Record<string, string>>;
  controller: AbortController;
}

export interface HostProcessExecutionRuntimeOptions {
  runner: CommandRunner;
  healthEnv?: Readonly<Record<string, string>>;
}

const commandNames = (command: string): string[] => {
  const normalized = command.replace(/\\/gu, '/');
  return [command, normalized.slice(normalized.lastIndexOf('/') + 1)];
};

const containsPath = (parent: string, child: string): boolean => {
  const normalize = (value: string): string => {
    const resolved = resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const path = relative(normalize(parent), normalize(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/**
 * Executes agents as children of the worker user. This scopes credentials,
 * cwd, commands and cancellation, but provides no OS, network or resource isolation.
 */
export class HostProcessExecutionRuntime implements AgentExecutionRuntime {
  private readonly sessions = new Map<string, HostProcessSession>();
  private state: 'running' | 'shutting-down' | 'closed' = 'running';
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: HostProcessExecutionRuntimeOptions) {}

  isAllowed(command: string): boolean {
    return this.options.runner.isAllowed(command);
  }

  async prepare(input: PrepareExecutionInput): Promise<ExecutionRuntimeDescriptor> {
    if (this.state !== 'running') {
      throw new Error(`Execution runtime is ${this.state}`);
    }
    if (this.sessions.has(input.runId)) {
      throw new Error(`Execution runtime is already prepared for run ${input.runId}`);
    }
    const allowedCommands = new Set(input.limits.allowedCommands.flatMap(commandNames));
    const descriptor: ExecutionRuntimeDescriptor = {
      runtimeId: `host-${randomUUID()}`,
      kind: 'HOST_PROCESS',
      isolated: false,
      workspacePath: resolve(input.workspacePath),
      startedAt: new Date().toISOString(),
      appliedLimits: {
        timeoutMs: input.limits.timeoutMs,
        allowedCommands: [...input.limits.allowedCommands],
      },
      credentialSource: input.credentialSource,
    };
    this.sessions.set(input.runId, {
      descriptor,
      allowedCommands,
      secretEnv: { ...input.secretEnv },
      controller: new AbortController(),
    });
    return descriptor;
  }

  async run(input: AgentCommandInput): Promise<CommandResult> {
    if (this.state !== 'running') {
      throw new Error(`Execution runtime is ${this.state}`);
    }
    if (input.scope === 'health') {
      return this.options.runner.run({ ...input, env: { ...this.options.healthEnv } });
    }

    const session = this.sessions.get(input.runId);
    if (!session) throw new Error(`Execution runtime is not prepared for run ${input.runId}`);
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

    try {
      return await this.options.runner.run({
        ...input,
        timeoutMs: Math.min(
          input.timeoutMs ?? session.descriptor.appliedLimits.timeoutMs,
          session.descriptor.appliedLimits.timeoutMs,
        ),
        env: { ...session.secretEnv },
        signal: controller.signal,
      });
    } finally {
      session.controller.signal.removeEventListener('abort', abort);
      input.signal?.removeEventListener('abort', abort);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.sessions.get(runId)?.controller.abort();
  }

  async release(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    session.controller.abort();
    this.sessions.delete(runId);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.state = 'shutting-down';
    this.shutdownPromise = Promise.resolve().then(() => {
      for (const session of this.sessions.values()) session.controller.abort();
      this.sessions.clear();
      this.state = 'closed';
    });
    return this.shutdownPromise;
  }
}
