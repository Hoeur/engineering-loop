import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/**
 * CI images and sandboxes often ship their own Chromium instead of the exact
 * build `playwright install` would fetch. Point PLAYWRIGHT_CHROMIUM_PATH at it
 * to run the suite there without re-downloading a browser.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

/**
 * The responsive matrix from spec section 36. Every project renders the same
 * suite at a different width so a layout regression fails on the exact viewport
 * that broke.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure', launchOptions },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'laptop-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile-430',
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'pnpm start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
