#!/usr/bin/env node
/**
 * Drops and recreates the `public` schema, then re-applies every migration.
 *
 * The engine-free equivalent of `prisma migrate reset` (see
 * docs/adr/0001-engine-free-prisma.md). Destructive by design and refuses to
 * run against anything but a development database unless forced.
 *
 *   node scripts/reset-database.mjs [--force]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as readEnvFile } from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, '..');
for (const file of [path.join(packageRoot, '..', '..', '.env'), path.join(packageRoot, '.env')]) {
  if (existsSync(file)) readEnvFile({ path: file, override: false, quiet: true });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const force = process.argv.includes('--force');
if (process.env.NODE_ENV === 'production' && !force) {
  console.error('Refusing to reset a production database. Re-run with --force if you mean it.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  console.error('dropped and recreated schema "public"');
} finally {
  await client.end();
}

execFileSync(process.execPath, [path.join(here, 'deploy-migrations.mjs')], { stdio: 'inherit' });
console.error('Reset complete. Load demo data with: pnpm db:seed');
