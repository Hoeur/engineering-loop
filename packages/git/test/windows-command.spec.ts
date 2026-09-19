import { describe, expect, it } from 'vitest';
import { resolveExecutable, type CommandLookup } from '../src/windows-command';

const NODE = 'C:\\nvm4w\\nodejs\\node.exe';

const windows = (files: Record<string, string | true>): CommandLookup => ({
  platform: 'win32',
  path: 'C:\\nvm4w\\nodejs;C:\\Windows\\System32',
  pathExt: '.COM;.EXE;.BAT;.CMD',
  nodePath: NODE,
  exists: (candidate) => candidate.replace(/\//g, '\\') in files,
  readText: (candidate) => {
    const entry = files[candidate.replace(/\//g, '\\')];
    return typeof entry === 'string' ? entry : null;
  },
});

const PNPM_SHIM = [
  '@echo off',
  'SET "NODE_EXE=%~dp0\\node.exe"',
  'node  "%~dp0\\node_modules\\corepack\\dist\\pnpm.js" %*',
].join('\r\n');

// npm's shim names npm-prefix.js before the CLI entry point it actually runs.
const NPM_SHIM = [
  ":: Created by npm, please don't edit manually.",
  '@ECHO OFF',
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (SET "NPM_PREFIX=%%F")',
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
].join('\r\n');

describe('resolveExecutable', () => {
  it('runs the Node script behind a pnpm shim, because Windows cannot spawn a .cmd', () => {
    const lookup = windows({
      'C:\\nvm4w\\nodejs\\pnpm.cmd': PNPM_SHIM,
      'C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\pnpm.js': true,
    });

    expect(resolveExecutable('pnpm', ['run', 'lint'], lookup)).toEqual({
      command: NODE,
      args: ['C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\pnpm.js', 'run', 'lint'],
      via: 'node-script',
    });
  });

  it('resolves npm to its CLI entry point, not the prefix helper it also names', () => {
    const lookup = windows({
      'C:\\nvm4w\\nodejs\\npm.cmd': NPM_SHIM,
      'C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-prefix.js': true,
      'C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js': true,
    });

    const resolved = resolveExecutable('npm', ['ci'], lookup);
    expect(resolved.command).toBe(NODE);
    expect(resolved.args).toEqual(['C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'ci']);
  });

  it('prefers a real executable over a shim of the same name', () => {
    const lookup = windows({
      'C:\\nvm4w\\nodejs\\pnpm.exe': true,
      'C:\\nvm4w\\nodejs\\pnpm.cmd': PNPM_SHIM,
      'C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\pnpm.js': true,
    });

    expect(resolveExecutable('pnpm', ['test'], lookup)).toEqual({
      command: 'C:\\nvm4w\\nodejs\\pnpm.exe',
      args: ['test'],
      via: 'direct',
    });
  });

  it('ignores the extension-less shell script installed next to the shim', () => {
    // npm and pnpm ship a Unix script called exactly `pnpm`; Windows cannot run it.
    const lookup = windows({
      'C:\\nvm4w\\nodejs\\pnpm': '#!/bin/sh\nnode pnpm.js "$@"',
      'C:\\nvm4w\\nodejs\\pnpm.cmd': PNPM_SHIM,
      'C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\pnpm.js': true,
    });

    expect(resolveExecutable('pnpm', ['-v'], lookup)).toEqual({
      command: NODE,
      args: ['C:\\nvm4w\\nodejs\\node_modules\\corepack\\dist\\pnpm.js', '-v'],
      via: 'node-script',
    });
  });

  it('leaves an absolute executable alone', () => {
    const lookup = windows({ 'C:\\Users\\me\\.local\\bin\\claude.exe': true });
    const resolved = resolveExecutable('C:/Users/me/.local/bin/claude.exe', ['-p'], lookup);
    expect(resolved.via).toBe('direct');
    expect(resolved.args).toEqual(['-p']);
  });

  it('reports a shim it cannot see through instead of rewriting it', () => {
    const lookup = windows({ 'C:\\nvm4w\\nodejs\\make.cmd': '@echo off\r\nmingw32-make %*' });
    expect(resolveExecutable('make', ['build'], lookup)).toEqual({
      command: 'C:\\nvm4w\\nodejs\\make.cmd',
      args: ['build'],
      via: 'unresolved-shim',
    });
  });

  it('returns the command untouched when nothing matches', () => {
    const lookup = windows({});
    expect(resolveExecutable('pnpm', ['lint'], lookup)).toEqual({
      command: 'pnpm',
      args: ['lint'],
      via: 'direct',
    });
  });

  it('changes nothing off Windows', () => {
    const lookup: CommandLookup = {
      platform: 'linux',
      path: '/usr/bin',
      pathExt: undefined,
      nodePath: '/usr/bin/node',
      exists: () => true,
      readText: () => null,
    };
    expect(resolveExecutable('pnpm', ['lint'], lookup)).toEqual({
      command: 'pnpm',
      args: ['lint'],
      via: 'direct',
    });
  });
});
