#!/usr/bin/env node
/**
 * Removes build output and, with --all, node_modules.
 *
 * Cross-platform on purpose: package scripts must not call `rm -rf`, which does
 * not exist on Windows. Pass a directory to clean just that workspace
 * (`node ../../scripts/clean.mjs .`); with no argument every workspace is
 * cleaned.
 */
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deep = process.argv.includes('--all');
const targets = [
  'dist',
  '.next',
  'coverage',
  'tsconfig.tsbuildinfo',
  'playwright-report',
  'test-results',
];
if (deep) targets.push('node_modules');

const explicit = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

const allWorkspaces = () => {
  const found = [root];
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) found.push(join(dir, entry));
  }
  return found;
};

const workspaces = explicit.length > 0 ? explicit.map((entry) => resolve(entry)) : allWorkspaces();

let removed = 0;
for (const workspace of workspaces) {
  for (const target of targets) {
    const path = join(workspace, target);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      console.log(`removed ${relative(root, path) || path}`);
      removed += 1;
    }
  }
}
console.log(removed === 0 ? 'Nothing to clean.' : `Cleaned ${String(removed)} path(s).`);
