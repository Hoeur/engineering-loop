import { defineConfig } from '@playwright/test';
import base from './playwright.config';

if (
  process.env.E2E_EDITORS_ACCEPTANCE !== '1' ||
  process.env.DATABASE_URL !== 'postgresql://engloop:engloop@127.0.0.1:55445/engloop_editors'
) {
  throw new Error(
    'Editor acceptance requires its explicit task-owned scratch database and E2E_EDITORS_ACCEPTANCE=1',
  );
}

// Explicit opt-in scratch services; this never attaches to a demo server.
export default defineConfig({
  ...base,
  testMatch: 'configuration-editors.spec.ts',
  workers: 2,
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://127.0.0.1:4095/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm start',
      url: 'http://127.0.0.1:3045',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3045' },
});
