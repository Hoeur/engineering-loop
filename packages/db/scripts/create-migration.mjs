#!/usr/bin/env node
/**
 * Creates a migration by diffing the last applied datamodel against the current
 * `schema.prisma`.
 *
 * `prisma migrate dev` introspects the database and is unavailable in EngLoop's
 * engine-free setup (docs/adr/0001-engine-free-prisma.md). `prisma migrate diff`
 * between two *datamodels* needs no database at all, so the previous datamodel
 * is kept as a snapshot next to the migrations and updated whenever a migration
 * is created. Prisma still generates the SQL; this script only decides what to
 * compare and where to write.
 *
 *   node scripts/create-migration.mjs add_deployment_targets
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');
const migrationsDir = path.join(packageRoot, 'prisma', 'migrations');
const snapshotPath = path.join(migrationsDir, 'applied-datamodel.prisma');
const prismaBin = path.join(packageRoot, '..', '..', 'node_modules', '.bin', 'prisma');

const rawName = process.argv[2];
if (!rawName) {
  console.error('Usage: node scripts/create-migration.mjs <migration_name>');
  process.exit(1);
}
const name = rawName
  .replace(/[^A-Za-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();
if (!name) {
  console.error('Migration name must contain at least one alphanumeric character.');
  process.exit(1);
}

const hasSnapshot = existsSync(snapshotPath);
const args = hasSnapshot
  ? [
      'migrate',
      'diff',
      '--from-schema-datamodel',
      snapshotPath,
      '--to-schema-datamodel',
      schemaPath,
      '--script',
    ]
  : ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'];

const sql = execFileSync(prismaBin, args, { cwd: packageRoot, encoding: 'utf8' });

// `migrate diff` emits a comment-only script when the two datamodels match.
const meaningful = sql
  .split('\n')
  .some((line) => line.trim() !== '' && !line.trim().startsWith('--'));

if (!meaningful) {
  console.error('No schema changes since the last migration.');
  process.exit(0);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, '')
  .slice(0, 14);
const existing = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
const dirName = existing.length === 0 ? '0_init' : `${stamp}_${name}`;
const target = path.join(migrationsDir, dirName);

mkdirSync(target, { recursive: true });
writeFileSync(path.join(target, 'migration.sql'), sql, 'utf8');
writeFileSync(path.join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"\n', 'utf8');
writeFileSync(snapshotPath, readFileSync(schemaPath, 'utf8'), 'utf8');

console.error(`created prisma/migrations/${dirName}/migration.sql`);
console.error('Review it, then apply with: pnpm db:deploy');
