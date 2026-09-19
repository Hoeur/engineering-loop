#!/usr/bin/env node
/**
 * One-command bootstrap: verify prerequisites, prepare .env, start
 * infrastructure, apply the schema and create only the configured real owner
 * and provider. Demo data is never loaded by this command.
 */
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (message) => console.log(`\x1b[36m›\x1b[0m ${message}`);
const warn = (message) => console.log(`\x1b[33m!\x1b[0m ${message}`);
const fail = (message) => {
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
  process.exit(1);
};

const run = (command, options = {}) => {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0 && !options.allowFailure) fail(`\`${command}\` failed`);
  return result.status === 0;
};

const has = (command) => {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

log('Checking prerequisites…');
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) fail(`Node 20+ is required (found ${process.versions.node})`);
if (!has('pnpm')) fail('pnpm is required — run `corepack enable`');
const hasDocker = has('docker');
if (!hasDocker) warn('docker not found — start PostgreSQL and Redis yourself');

if (!existsSync(join(root, '.env'))) {
  copyFileSync(join(root, '.env.example'), join(root, '.env'));
  log('Created .env from .env.example');
}

log('Installing dependencies…');
run('pnpm install');

if (hasDocker) {
  log('Starting PostgreSQL and Redis…');
  run('docker compose up -d postgres redis');
  log('Waiting for the database to accept connections…');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      run('docker compose exec -T postgres pg_isready -U engloop', {
        stdio: 'ignore',
        allowFailure: true,
      })
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

log('Generating the Prisma client…');
run('pnpm db:generate');

log('Building shared packages…');
run('pnpm build:packages');

log('Applying the database schema…');
run('pnpm db:deploy');

log('Creating the configured real owner, organization and provider…');
run('pnpm bootstrap:real');

console.log(`
\x1b[32m✓ EngLoop is ready.\x1b[0m

  pnpm dev            web http://localhost:3000
                      api http://localhost:4000/api
                      docs http://localhost:4000/api/docs

  Sign in with ENGLOOP_BOOTSTRAP_ADMIN_EMAIL and
  ENGLOOP_BOOTSTRAP_ADMIN_PASSWORD from .env.
`);
