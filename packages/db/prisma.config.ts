import path from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Declaring an `adapter` here makes every CLI command (`migrate`, `db push`,
 * `db seed`, `studio`) talk to PostgreSQL through the `pg` driver and run schema
 * diffing in the bundled WebAssembly schema engine. Combined with the
 * `queryCompiler` preview feature on the generator, EngLoop needs **no
 * platform-specific Prisma engine binaries at all** — install works behind a
 * restrictive egress policy, in slim containers and on unusual architectures.
 *
 * A config file suppresses Prisma's own `.env` loading, so we do it explicitly.
 * The repo root `.env` is the single source of truth; a package-local `.env`
 * (if present) wins so individual packages can be pointed at a scratch database.
 */
loadEnv({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
loadEnv({ path: path.join(__dirname, '.env'), override: true, quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env at the repository root before running Prisma commands.',
  );
}

export default defineConfig({
  // `adapter` (driver adapters in the CLI) is still gated behind an experimental
  // flag in Prisma 6.x; it becomes the default in Prisma 7.
  experimental: { adapter: true },
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  adapter: async () => new PrismaPg({ connectionString }),
});
