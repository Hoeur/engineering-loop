import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROJECT_COMMANDS } from '@engloop/config';
import type { CheckType } from '@engloop/types';

/**
 * Where a check command came from. A command the repository configured is a promise and
 * always runs; a default is a guess about a Node repository and must not be trusted when
 * the worktree cannot honour it.
 */
export type CommandSource = 'configured' | 'default';

export interface ResolvedCheckCommand {
  commandLine: string;
  source: CommandSource;
}

export interface PackageManifest {
  scripts: Record<string, string>;
}

const CHECK_TO_COMMAND_KEY: Record<CheckType, keyof typeof DEFAULT_PROJECT_COMMANDS> = {
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  UNIT: 'unit',
  INTEGRATION: 'integration',
  BUILD: 'build',
  E2E: 'e2e',
  SECURITY: 'lint',
  CUSTOM: 'lint',
};

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

export const resolveCheckCommand = (
  commands: Record<string, string>,
  checkType: CheckType,
): ResolvedCheckCommand | null => {
  const key = CHECK_TO_COMMAND_KEY[checkType];
  const configured = commands[key] ?? commands[checkType.toLowerCase()];
  if (configured) return { commandLine: configured, source: 'configured' };
  const fallback = DEFAULT_PROJECT_COMMANDS[key];
  return fallback ? { commandLine: fallback, source: 'default' } : null;
};

/** The package script a `<manager> [run] <script>` line runs, if it is one. */
export const scriptNameOf = (commandLine: string): string | null => {
  const [manager, ...rest] = commandLine.trim().split(/\s+/).filter(Boolean);
  if (!manager || !PACKAGE_MANAGERS.includes(manager.toLowerCase())) return null;
  const words = rest[0] === 'run' ? rest.slice(1) : rest;
  const name = words[0];
  if (!name || name.startsWith('-')) return null;
  return name;
};

export const readManifest = (worktreePath: string): PackageManifest | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(worktreePath, 'package.json'), 'utf8'));
    const scripts =
      parsed && typeof parsed === 'object' && 'scripts' in parsed
        ? (parsed as { scripts?: unknown }).scripts
        : undefined;
    return { scripts: (scripts ?? {}) as Record<string, string> };
  } catch {
    return null;
  }
};

/**
 * Why a default command cannot describe this worktree — `null` when it should run.
 *
 * Without this, a repository with no `package.json` sends `pnpm lint` up the directory
 * tree until a package manager finds one: EngLoop's own scripts ran, passed, and were
 * recorded as the task's evidence. A check that cannot run is skipped and says so
 * instead of inventing a result in either direction.
 */
export const skipDefaultReason = (
  command: ResolvedCheckCommand,
  manifest: PackageManifest | null,
): string | null => {
  if (command.source === 'configured') return null;
  if (!manifest) {
    return `the worktree has no package.json, so "${command.commandLine}" would run in the parent project`;
  }
  const script = scriptNameOf(command.commandLine);
  if (script && !manifest.scripts[script]) {
    return `the repository has no "${script}" script, so "${command.commandLine}" does not apply`;
  }
  return null;
};
