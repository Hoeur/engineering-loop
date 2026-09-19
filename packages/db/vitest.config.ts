import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
