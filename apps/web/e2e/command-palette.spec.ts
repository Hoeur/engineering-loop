import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('engloop.auth.token', 'e2e-session');
  });
});

test.describe('command palette', () => {
  test('opens with the keyboard shortcut and filters entries', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+k');

    const input = page.getByPlaceholder('Jump to a screen or task…');
    await expect(input).toBeVisible();

    await input.fill('costs');
    await expect(page.getByRole('button', { name: /Costs/ })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/insights\/costs$/);
  });
});
