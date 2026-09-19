import fs from 'node:fs';
import path from 'node:path';

import { config as readEnvFile } from 'dotenv';

/**
 * Marker files that identify the repository root when walking up from a service
 * directory. `apps/api` and `apps/worker` are started from their own folders, so
 * the root `.env` has to be discovered rather than assumed.
 */
const ROOT_MARKERS = ['pnpm-workspace.yaml', '.git'] as const;

const findRepositoryRoot = (startDir: string): string | undefined => {
  let dir = path.resolve(startDir);

  for (;;) {
    if (ROOT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

let loaded = false;

/**
 * Loads `.env` into `process.env` once per process.
 *
 * Resolution order, lowest priority first:
 *   1. `<repo root>/.env`      — the shared local development file
 *   2. `<cwd>/.env`            — optional per-service override
 *   3. the real process environment — always wins
 *
 * Real environment variables are never overwritten, so `docker compose`
 * (`env_file:` + `environment:`), CI secrets and `KEY=value pnpm …` one-offs all
 * take precedence over the checked-out file. Production images that inject
 * configuration directly simply have no `.env` to find.
 */
export const loadDotEnvOnce = (startDir: string = process.cwd()): void => {
  if (loaded) {
    return;
  }
  loaded = true;

  const candidates = [findRepositoryRoot(startDir), path.resolve(startDir)]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.join(dir, '.env'));

  for (const file of new Set(candidates)) {
    if (fs.existsSync(file)) {
      readEnvFile({ path: file, override: false, quiet: true });
    }
  }
};

/** Test hook — lets suites re-run loading against a fixture directory. */
export const resetDotEnvForTesting = (): void => {
  loaded = false;
};
