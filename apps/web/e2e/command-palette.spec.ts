import { expect, test } from './fixtures';

test.describe('command palette', () => {
  test('opens with the keyboard shortcut and filters entries', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('Jump to a screen or task…');
    // The shortcut listener attaches on hydration, which `goto` does not await.
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(input).toBeVisible({ timeout: 1_000 });
    }).toPass();

    await input.fill('costs');
    await expect(page.getByRole('button', { name: /Costs/ })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/insights\/costs$/);
  });
});
