import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import type { CommandResult } from '@engloop/types';
import { silentLogger, type EngLoopLogger } from '@engloop/logger';
import { CommandNotAllowedError, CommandTimeoutError } from './errors';
import { resolveExecutable } from './windows-command';

export interface CommandRunnerOptions {
  /** Executables the runner may spawn. Anything else is refused up front. */
  allowlist: readonly string[];
  defaultTimeoutMs: number;
  maxBufferBytes: number;
  logger?: EngLoopLogger;
  /** Environment variables passed through to child processes. */
  envAllowlist?: readonly string[];
}

export interface RunCommandInput {
  command: string;
  args: readonly string[];
  cwd: string;
  /** UTF-8 input written directly to the child process. Never logged. */
  stdin?: string;
  /** Cancels the process and its descendants without relying on shell semantics. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra environment for this call. Values are never logged. */
  env?: Record<string, string>;
  /** Throw a CommandFailedError on a non-zero exit instead of returning it. */
  throwOnFailure?: boolean;
  label?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

const DEFAULT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'SHELL',
  'USER',
  'NODE_ENV',
  'CI',
  'npm_config_registry',
  'COREPACK_ENABLE_STRICT',
  'PNPM_HOME',
  'SYSTEMROOT',
  'COMSPEC',
  // Windows equivalents of HOME/TMPDIR. Without them npm and pnpm cannot find their
  // config, cache or store and fail before they run anything.
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PATHEXT',
  'TEMP',
  'TMP',
  'SYSTEMDRIVE',
  'NUMBER_OF_PROCESSORS',
] as const;

/**
 * Secure command runner (spec section 12).
 *
 * Guarantees:
 *  - never builds a shell string; always `spawn(cmd, args[], { shell: false })`
 *  - refuses executables outside the allowlist
 *  - kills the process group on timeout (SIGTERM, then SIGKILL)
 *  - caps captured output so a runaway build cannot exhaust worker memory
 *  - passes only allowlisted environment variables to the child
 */
export class CommandRunner {
  private readonly logger: EngLoopLogger;
  private readonly envAllowlist: readonly string[];

  constructor(private readonly options: CommandRunnerOptions) {
    this.logger = options.logger ?? silentLogger;
    this.envAllowlist = options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  }

  isAllowed(command: string): boolean {
    const bare = command.split(/[\\/]/).pop() ?? command;
    return this.options.allowlist.includes(bare) || this.options.allowlist.includes(command);
  }

  assertAllowed(command: string): void {
    if (!this.isAllowed(command)) throw new CommandNotAllowedError(command);
  }

  private buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of this.envAllowlist) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return { ...env, ...extra };
  }

  async run(input: RunCommandInput): Promise<CommandResult> {
    this.assertAllowed(input.command);

    const cwd = resolvePath(input.cwd);
    const timeoutMs = input.timeoutMs ?? this.options.defaultTimeoutMs;
    const startedAt = new Date();
    const args = [...input.args];
    // Windows refuses to start the `.cmd` shims npm, pnpm and npx install, so the
    // allowlisted name is resolved to something spawnable — still no shell involved.
    const executable = resolveExecutable(input.command, args);

    this.logger.debug(
      {
        command: input.command,
        args,
        cwd,
        timeoutMs,
        label: input.label,
        ...(executable.via === 'direct' ? {} : { resolvedVia: executable.via }),
      },
      'command.start',
    );

    return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
      const child = spawn(executable.command, executable.args, {
        cwd,
        env: this.buildEnv(input.env),
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });

      // Always close stdin so non-interactive commands cannot wait indefinitely.
      // An early child exit may close the pipe before the buffered write completes;
      // the process exit/result remains the authoritative outcome in that case.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(input.stdin ?? '', 'utf8');

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const append = (target: 'out' | 'err', chunk: string) => {
        const current = target === 'out' ? stdout : stderr;
        const remaining = this.options.maxBufferBytes - current.length;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        if (slice.length < chunk.length) truncated = true;
        if (target === 'out') stdout += slice;
        else stderr += slice;
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        append('out', chunk);
        input.onStdout?.(chunk);
      });
      child.stderr?.on('data', (chunk: string) => {
        append('err', chunk);
        input.onStderr?.(chunk);
      });

      const killTree = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, signal);
          } else if (child.pid) {
            // End the direct child immediately; taskkill then removes descendants.
            child.kill('SIGKILL');
            const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
              shell: false,
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.unref();
          } else {
            child.kill(signal);
          }
        } catch {
          /* process already gone */
        }
      };

      const onAbort = () => {
        cancelled = true;
        killTree('SIGTERM');
      };
      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (input.signal?.aborted) onAbort();

      const timer = setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        setTimeout(() => killTree('SIGKILL'), 5_000).unref?.();
      }, timeoutMs);

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        const completedAt = new Date();
        const result: CommandResult = {
          command: input.command,
          args,
          cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          truncated,
          timedOut,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
        };

        this.logger.debug(
          {
            command: input.command,
            exitCode,
            timedOut,
            durationMs: result.durationMs,
            label: input.label,
          },
          'command.finish',
        );

        if (timedOut) {
          rejectPromise(new CommandTimeoutError(input.command, timeoutMs));
          return;
        }
        if (cancelled) {
          rejectPromise(
            Object.assign(new Error(`Command "${input.command}" was cancelled`), {
              name: 'AbortError',
            }),
          );
          return;
        }
        if (input.throwOnFailure && exitCode !== 0) {
          rejectPromise(
            Object.assign(
              new Error(
                `Command "${input.command} ${args.join(' ')}" exited with code ${String(exitCode)}`,
              ),
              { name: 'CommandFailedError', result },
            ),
          );
          return;
        }
        resolvePromise(result);
      };

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        rejectPromise(error);
      });
      child.on('close', (code, signal) => finish(code, signal));
    });
  }
}

/** Convenience factory used by services that only need process defaults. */
export const createCommandRunner = (options: CommandRunnerOptions): CommandRunner =>
  new CommandRunner(options);
