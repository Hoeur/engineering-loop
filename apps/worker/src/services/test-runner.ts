import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CheckStatus, CheckType } from '@engloop/types';
import { DEFAULT_PROJECT_COMMANDS, MAX_LOG_BYTES, type Env } from '@engloop/config';
import { readManifest, resolveCheckCommand, skipDefaultReason } from './check-commands';
import type { EngLoopLogger } from '@engloop/logger';
import type { CommandRunner } from '@engloop/git';
import type { PrismaClient } from '@engloop/db';
import type { AuditWriter } from './audit-writer';

export interface RunChecksInput {
  testRunId: string;
  taskId: string;
  checks: CheckType[];
  worktreePath: string;
  traceId: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface RunChecksOutcome {
  testRunId: string;
  passed: boolean;
  failedChecks: {
    checkType: CheckType;
    command: string;
    exitCode: number | null;
    output: string;
  }[];
  totals: { total: number; passed: number; failed: number };
  durationMs: number;
}

interface TestRunnerDeps {
  prisma: PrismaClient;
  runner: CommandRunner;
  logger: EngLoopLogger;
  env: Env;
  audit: AuditWriter;
}

/**
 * Deterministic verification (spec sections 13 and 43).
 *
 * The system runs these commands itself and records real exit codes. `passed` is
 * computed here — an agent claiming "all tests pass" has no effect on it.
 */
export class TestRunner {
  constructor(private readonly deps: TestRunnerDeps) {}

  /**
   * A fresh worktree has no dependencies, so every check would fail on a missing binary
   * before it ran anything. The repository's own install command runs once per check
   * pass, and only when the worktree has a manifest and no `node_modules` yet.
   */
  private async installDependencies(input: {
    commands: Record<string, string>;
    worktreePath: string;
    testRunId: string;
    taskKey: string;
    traceId: string;
  }): Promise<RunChecksOutcome['failedChecks'][number] | null> {
    const { prisma, runner, env } = this.deps;
    const commandLine = input.commands.install ?? DEFAULT_PROJECT_COMMANDS.install;
    const hasManifest = existsSync(join(input.worktreePath, 'package.json'));
    const alreadyInstalled = existsSync(join(input.worktreePath, 'node_modules'));
    if (!commandLine || !hasManifest || alreadyInstalled) return null;

    const [executable = '', ...args] = commandLine.split(/\s+/).filter(Boolean);
    const record = async (data: {
      status: CheckStatus;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      durationMs: number;
    }) => {
      await prisma.testResult.create({
        data: {
          testRunId: input.testRunId,
          checkType: CheckType.CUSTOM,
          name: 'install',
          command: commandLine,
          truncated: false,
          startedAt: new Date(Date.now() - data.durationMs),
          completedAt: new Date(),
          ...data,
        },
      });
    };

    if (!runner.isAllowed(executable)) {
      const message = `Command "${executable}" is not in COMMAND_ALLOWLIST`;
      await record({
        status: CheckStatus.FAILED,
        exitCode: null,
        stdout: '',
        stderr: message,
        durationMs: 0,
      });
      return { checkType: CheckType.CUSTOM, command: commandLine, exitCode: null, output: message };
    }

    try {
      const result = await runner.run({
        command: executable,
        args,
        cwd: input.worktreePath,
        timeoutMs: env.COMMAND_TIMEOUT_MS,
        label: `${input.taskKey}:install`,
      });
      await record({
        status: result.exitCode === 0 ? CheckStatus.PASSED : CheckStatus.FAILED,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(-MAX_LOG_BYTES),
        stderr: result.stderr.slice(-MAX_LOG_BYTES),
        durationMs: result.durationMs,
      });
      if (result.exitCode === 0) return null;
      return {
        checkType: CheckType.CUSTOM,
        command: commandLine,
        exitCode: result.exitCode,
        output: `${result.stdout}\n${result.stderr}`.slice(-MAX_LOG_BYTES),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record({
        status: CheckStatus.FAILED,
        exitCode: null,
        stdout: '',
        stderr: message,
        durationMs: 0,
      });
      return { checkType: CheckType.CUSTOM, command: commandLine, exitCode: null, output: message };
    }
  }

  async run(input: RunChecksInput): Promise<RunChecksOutcome> {
    const { prisma, runner, logger, env, audit } = this.deps;
    const startedAt = Date.now();

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: {
        id: true,
        key: true,
        projectId: true,
        project: { select: { organizationId: true } },
        repository: { select: { commands: true } },
      },
    });

    const commands = (task.repository?.commands ?? {}) as Record<string, string>;
    const runLogger = logger.withContext({
      traceId: input.traceId,
      taskId: input.taskId,
      taskKey: task.key,
      workflowRunId: input.workflowRunId,
    });

    await prisma.testRun.update({
      where: { id: input.testRunId },
      data: {
        status: CheckStatus.RUNNING,
        startedAt: new Date(),
        worktreePath: input.worktreePath,
        totalChecks: input.checks.length,
        workflowRunId: input.workflowRunId ?? null,
        workflowStepId: input.workflowStepId ?? null,
      },
    });

    const workspaceMissing = !existsSync(input.worktreePath);
    const failed: RunChecksOutcome['failedChecks'] = [];
    let passedCount = 0;

    if (!workspaceMissing) {
      const installFailure = await this.installDependencies({
        commands,
        worktreePath: input.worktreePath,
        testRunId: input.testRunId,
        taskKey: task.key,
        traceId: input.traceId,
      });
      if (installFailure) {
        runLogger.warn(
          { command: installFailure.command, exitCode: installFailure.exitCode },
          'checks.install.failed',
        );
        failed.push(installFailure);
      }
    }

    const manifest = workspaceMissing ? null : readManifest(input.worktreePath);

    for (const checkType of input.checks) {
      const resolved = resolveCheckCommand(commands, checkType);
      const commandLine = resolved?.commandLine ?? null;
      const existing = await prisma.testResult.findFirst({
        where: { testRunId: input.testRunId, checkType },
      });

      const record = async (data: {
        status: CheckStatus;
        command: string;
        exitCode: number | null;
        stdout: string;
        stderr: string;
        durationMs: number;
        truncated: boolean;
      }) => {
        const payload = {
          testRunId: input.testRunId,
          checkType,
          name: checkType.toLowerCase(),
          ...data,
          startedAt: new Date(Date.now() - data.durationMs),
          completedAt: new Date(),
        };
        if (existing) await prisma.testResult.update({ where: { id: existing.id }, data: payload });
        else await prisma.testResult.create({ data: payload });
      };

      if (!commandLine || workspaceMissing) {
        const reason = workspaceMissing
          ? `Worktree ${input.worktreePath} does not exist on this worker`
          : `No command configured for ${checkType}`;
        await record({
          status: CheckStatus.SKIPPED,
          command: commandLine ?? '(no command configured)',
          exitCode: null,
          stdout: '',
          stderr: reason,
          durationMs: 0,
          truncated: false,
        });
        failed.push({
          checkType,
          command: commandLine ?? '(no command configured)',
          exitCode: null,
          output: reason,
        });
        continue;
      }

      // A default command is a guess about a Node repository. When the worktree cannot
      // honour it the check is skipped, not failed and not run — a package manager left
      // to search upwards would otherwise run (and pass) the parent project's scripts.
      const notApplicable = resolved ? skipDefaultReason(resolved, manifest) : null;
      if (notApplicable) {
        const reason = `${checkType} skipped: ${notApplicable}`;
        runLogger.info({ checkType, command: commandLine }, 'checks.default_not_applicable');
        await record({
          status: CheckStatus.SKIPPED,
          command: commandLine,
          exitCode: null,
          stdout: '',
          stderr: reason,
          durationMs: 0,
          truncated: false,
        });
        continue;
      }

      const [executable = '', ...args] = commandLine.split(/\s+/).filter(Boolean);
      if (!runner.isAllowed(executable)) {
        await record({
          status: CheckStatus.FAILED,
          command: commandLine,
          exitCode: null,
          stdout: '',
          stderr: `Command "${executable}" is not in COMMAND_ALLOWLIST`,
          durationMs: 0,
          truncated: false,
        });
        failed.push({
          checkType,
          command: commandLine,
          exitCode: null,
          output: `Command "${executable}" is not allowlisted`,
        });
        continue;
      }

      try {
        const result = await runner.run({
          command: executable,
          args,
          cwd: input.worktreePath,
          timeoutMs: env.COMMAND_TIMEOUT_MS,
          label: `${task.key}:${checkType}`,
        });

        const ok = result.exitCode === 0;
        if (ok) passedCount += 1;
        else {
          failed.push({
            checkType,
            command: commandLine,
            exitCode: result.exitCode,
            output: `${result.stdout}\n${result.stderr}`.slice(-MAX_LOG_BYTES),
          });
        }

        await record({
          status: ok ? CheckStatus.PASSED : CheckStatus.FAILED,
          command: commandLine,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(-MAX_LOG_BYTES),
          stderr: result.stderr.slice(-MAX_LOG_BYTES),
          durationMs: result.durationMs,
          truncated: result.truncated,
        });

        await audit.record({
          organizationId: task.project.organizationId,
          projectId: task.projectId,
          taskId: task.id,
          action: AuditAction.COMMAND_EXECUTED,
          entityType: 'test_result',
          summary: `${checkType}: ${commandLine} → exit ${String(result.exitCode)}`,
          metadata: { cwd: input.worktreePath, durationMs: result.durationMs },
          traceId: input.traceId,
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'CommandTimeoutError';
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ checkType, command: commandLine, exitCode: null, output: message });
        await record({
          status: timedOut ? CheckStatus.TIMEOUT : CheckStatus.FAILED,
          command: commandLine,
          exitCode: null,
          stdout: '',
          stderr: message,
          durationMs: env.COMMAND_TIMEOUT_MS,
          truncated: false,
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    const passed = failed.length === 0;

    await prisma.testRun.update({
      where: { id: input.testRunId },
      data: {
        status: passed ? CheckStatus.PASSED : CheckStatus.FAILED,
        passed,
        passedChecks: passedCount,
        failedChecks: failed.length,
        durationMs,
        completedAt: new Date(),
      },
    });

    runLogger.info(
      { testRunId: input.testRunId, passed, failed: failed.length, durationMs },
      'tests.completed',
    );

    return {
      testRunId: input.testRunId,
      passed,
      failedChecks: failed,
      totals: { total: input.checks.length, passed: passedCount, failed: failed.length },
      durationMs,
    };
  }
}
