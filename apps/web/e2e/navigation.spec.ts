import { expect, test } from './fixtures';

/**
 * Responsive contract from spec section 36: the shell must be usable, and must
 * never scroll sideways, at every viewport the project targets.
 */
const ROUTES = [
  '/',
  '/inbox',
  '/projects',
  '/engineering/tasks',
  '/engineering/agent-runs',
  '/engineering/reviews',
  '/agents/team',
  '/automation/workflows',
  '/quality/bugs',
  '/insights/costs',
  '/settings',
];

test.describe('application shell', () => {
  for (const route of ROUTES) {
    test(`renders ${route} without horizontal overflow`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // Allow a 1px rounding tolerance at fractional device pixel ratios.
      expect(
        overflow,
        `${route} overflows horizontally by ${String(overflow)}px`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test('exposes navigation at every width', async ({ page, viewport }) => {
    await page.goto('/');

    if ((viewport?.width ?? 1440) < 768) {
      // Mobile: navigation lives behind a drawer.
      const trigger = page.getByRole('button', { name: 'Open navigation' });
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    }
  });

  test('collapses the sidebar on desktop', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, 'desktop-only affordance');
    await page.goto('/');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  });
});
