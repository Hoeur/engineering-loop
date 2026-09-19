import { existsSync, readFileSync } from 'node:fs';
import { posix as posixPath, win32 as winPath } from 'node:path';

/**
 * Windows cannot start a `.cmd`/`.bat` file with `CreateProcess`, and npm, pnpm, npx and
 * yarn are all installed as exactly that. With `shell: false` — which this runner never
 * gives up — `spawn('pnpm', …)` therefore fails with `spawn pnpm ENOENT`, and every
 * repository check fails before it runs.
 *
 * Handing the line to `cmd.exe` would fix the symptom and open a shell-quoting hole, so
 * instead the shim is resolved to the Node script it was generated to run, and that
 * script is spawned with the current Node binary: `node …/node_modules/npm/bin/npm-cli.js`.
 */
export interface ResolvedCommand {
  command: string;
  args: string[];
  /** How the command was resolved — `direct` means it was already executable. */
  via: 'direct' | 'node-script' | 'unresolved-shim';
}

export interface CommandLookup {
  platform: NodeJS.Platform;
  path: string | undefined;
  pathExt: string | undefined;
  /** Node binary used to run a resolved script. */
  nodePath: string;
  exists: (candidate: string) => boolean;
  readText: (candidate: string) => string | null;
}

export const systemLookup = (): CommandLookup => ({
  platform: process.platform,
  path: process.env.PATH,
  pathExt: process.env.PATHEXT,
  nodePath: process.execPath,
  exists: (candidate) => existsSync(candidate),
  readText: (candidate) => {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      return null;
    }
  },
});

const SHIM_EXTENSIONS = ['.cmd', '.bat'];
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** `"%~dp0\node_modules\npm\bin\npm-cli.js"` — the scripts a Node shim names. */
const SCRIPTS_IN_SHIM = /%~dp0\\?([^"'\s%]+\.js)/gi;

// Windows path semantics regardless of the host the tests run on.
const pathApi = (lookup: CommandLookup) => (lookup.platform === 'win32' ? winPath : posixPath);

const extensionsFor = (lookup: CommandLookup): string[] =>
  (lookup.pathExt ?? DEFAULT_PATHEXT)
    .split(pathApi(lookup).delimiter)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const hasDirectory = (command: string): boolean => /[\\/]/.test(command);

const endsWithAny = (value: string, extensions: readonly string[]): boolean =>
  extensions.some((extension) => value.toLowerCase().endsWith(extension));

/**
 * Every candidate for the command, real executables before shims.
 *
 * Only names carrying an executable extension count: npm and pnpm also install an
 * extension-less shell script next to their shim, and Windows cannot run that either.
 */
const candidates = (command: string, lookup: CommandLookup): string[] => {
  const extensions = extensionsFor(lookup);
  const ordered = [
    ...extensions.filter((extension) => !SHIM_EXTENSIONS.includes(extension)),
    ...SHIM_EXTENSIONS.filter((extension) => extensions.includes(extension)),
  ];
  const forBase = (base: string): string[] =>
    endsWithAny(base, ordered) ? [base] : ordered.map((extension) => `${base}${extension}`);

  if (hasDirectory(command)) return forBase(command);

  const { join, delimiter } = pathApi(lookup);
  return (lookup.path ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => forBase(join(directory, command)));
};

/**
 * The Node script a `.cmd`/`.bat` shim delegates to, when it has one.
 *
 * A shim may name several: npm's also runs `npm-prefix.js` to read a config value, so
 * the CLI entry point wins over whatever appears first in the file.
 */
export const scriptBehindShim = (shimPath: string, lookup: CommandLookup): string | null => {
  const text = lookup.readText(shimPath);
  if (!text) return null;
  const { dirname, join } = pathApi(lookup);
  const scripts = [...text.matchAll(SCRIPTS_IN_SHIM)]
    .map((match) => join(dirname(shimPath), match[1] ?? ''))
    .filter((script) => lookup.exists(script));
  return scripts.find((script) => script.toLowerCase().endsWith('-cli.js')) ?? scripts[0] ?? null;
};

/**
 * Resolves a command to something this platform can actually spawn without a shell.
 * Off Windows, and for anything already executable, the command is returned unchanged.
 */
export const resolveExecutable = (
  command: string,
  args: readonly string[],
  lookup: CommandLookup = systemLookup(),
): ResolvedCommand => {
  if (lookup.platform !== 'win32') return { command, args: [...args], via: 'direct' };

  const found = candidates(command, lookup).find((candidate) => lookup.exists(candidate));
  if (!found) return { command, args: [...args], via: 'direct' };
  if (!endsWithAny(found, SHIM_EXTENSIONS)) {
    return { command: found, args: [...args], via: 'direct' };
  }

  const script = scriptBehindShim(found, lookup);
  if (!script) return { command: found, args: [...args], via: 'unresolved-shim' };
  return { command: lookup.nodePath, args: [script, ...args], via: 'node-script' };
};
