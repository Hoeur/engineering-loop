import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('engloop.auth.token', 'e2e-session');
  });
});

/**
 * Spec section 37: no screen may be blank. With the API unreachable, every
 * screen must render an explicit connection-problem state instead of nothing.
 */
test.describe('error and empty states', () => {
  test('shows a connection-problem state when the API is down', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.goto('/engineering/tasks');

    await expect(page.getByText('Cannot reach the EngLoop API')).toBeVisible({ timeout: 15_000 });
  });

  test('shows an empty state when the API returns no tasks', async ({ page }) => {
    await page.route('**/api/tasks*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [], meta: {} }, meta: {} }),
      }),
    );
    await page.goto('/engineering/tasks');

    await expect(page.getByText('No tasks match these filters')).toBeVisible({ timeout: 15_000 });
  });

  test('renders a not-found page for an unknown route', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
