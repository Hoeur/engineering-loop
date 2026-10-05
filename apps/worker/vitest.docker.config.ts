import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/docker-runtime/*.integration.ts'],
    passWithNoTests: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
