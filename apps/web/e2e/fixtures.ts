import { request, test as base } from '@playwright/test';

/**
 * The suite authenticates through the real login route, exactly as an operator
 * would, so it exercises `AuthGate` and the API guard together instead of
 * planting a token the API would reject. One login per worker keeps the cost
 * to a single request.
 *
 * Defaults match `pnpm db:seed`; override them to run against another database.
 */
const API_URL = (
  process.env.E2E_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000/api'
).replace(/\/$/, '');
const LOGIN_URL = `${API_URL}/auth/login`;
const EMAIL = process.env.E2E_USER_EMAIL ?? 'founder@evalley.dev';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'engloop-dev-password';

interface LoginEnvelope {
  success: boolean;
  data?: { token: string };
  error?: { code: string; message: string };
}

export const test = base.extend<{ authToken: string }, { workerAuthToken: string }>({
  workerAuthToken: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form
    async ({}, use) => {
      const api = await request.newContext();
      const response = await api.post(LOGIN_URL, { data: { email: EMAIL, password: PASSWORD } });
      const body = (await response.json().catch(() => null)) as LoginEnvelope | null;
      await api.dispose();

      if (!response.ok() || !body?.data?.token) {
        const reason = body?.error?.message ?? `HTTP ${String(response.status())}`;
        throw new Error(
          `E2E login failed for ${EMAIL} at ${LOGIN_URL}: ${reason}. ` +
            'Start the API and seed it (`pnpm db:seed`), or set E2E_API_URL, E2E_USER_EMAIL and E2E_USER_PASSWORD.',
        );
      }

      await use(body.data.token);
    },
    { scope: 'worker' },
  ],

  authToken: async ({ workerAuthToken }, use) => {
    await use(workerAuthToken);
  },

  page: async ({ page, authToken }, use) => {
    await page.addInitScript((token: string) => {
      window.localStorage.setItem('engloop.auth.token', token);
    }, authToken);
    await use(page);
  },
});

export { expect } from '@playwright/test';
