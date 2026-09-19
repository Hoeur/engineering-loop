#!/usr/bin/env node
/**
 * Cross-platform launcher for `next dev` and `next start`.
 *
 * package.json scripts must not use POSIX `${VAR:-default}` expansion: on
 * Windows pnpm runs scripts through cmd.exe, which passes the text through
 * literally and Next fails with
 *   option '-p, --port <port>' argument '${WEB_PORT:' is invalid.
 *
 * Resolving the port in Node fixes that and does something the shell never
 * could: it reads WEB_PORT from the repository-root `.env`, the same file the
 * API and worker use.
 *
 *   node scripts/next-server.mjs dev
 *   node scripts/next-server.mjs start
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as readEnvFile } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');
const mode = process.argv[2] === 'start' ? 'start' : 'dev';

// Captured before the file is read: a NODE_ENV the operator actually exported
// wins, but the shared `.env` (NODE_ENV=development, for the API and worker)
// must not put `next start` into development mode.
const explicitNodeEnv = process.env.NODE_ENV;

for (const file of [path.join(appRoot, '..', '..', '.env'), path.join(appRoot, '.env')]) {
  if (existsSync(file)) readEnvFile({ path: file, override: false, quiet: true });
}

process.env.NODE_ENV = explicitNodeEnv ?? (mode === 'start' ? 'production' : 'development');
const requested = process.env.WEB_PORT ?? process.env.PORT ?? '3000';
const port = Number.parseInt(requested, 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`WEB_PORT must be a port number between 1 and 65535 (got "${requested}").`);
  process.exit(1);
}

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [nextBin, mode, '--port', String(port), ...process.argv.slice(3)],
  {
    cwd: appRoot,
    stdio: 'inherit',
    // No shell: the argument vector is passed straight through on every platform.
    shell: false,
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
