import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as readEnvFile } from 'dotenv';

/**
 * Next only reads `.env` files next to the app. EngLoop keeps one `.env` at the
 * repository root (the same file `docker compose`, the API and the worker use),
 * so load it here — before compilation inlines any `NEXT_PUBLIC_*` value.
 * Real environment variables still win, so CI and container config override it.
 */
const here = dirname(fileURLToPath(import.meta.url));
for (const file of [join(here, '..', '..', '.env'), join(here, '.env')]) {
  if (existsSync(file)) readEnvFile({ path: file, override: false, quiet: true });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @engloop/ui ships TSX source; everything else is prebuilt CJS.
  transpilePackages: ['@engloop/ui'],
  eslint: {
    // Linting is a workspace-level command (`pnpm lint`), not part of `next build`.
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
  },
};

export default nextConfig;
