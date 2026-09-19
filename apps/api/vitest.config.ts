import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC compiles the decorators + emitDecoratorMetadata that NestJS relies on;
  // esbuild (vitest's default) does not emit decorator metadata.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
