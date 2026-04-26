/**
 * E2E — admin reviews moderation page.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin reviews', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: reviews page renders heading + table or empty state', async ({ page }) => {
    await page.goto('/admin/reviews');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /reviews|المراجعات/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page.getByText(/no reviews|empty|لا يوجد|لا توجد/i).first().isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: cleared session redirects', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/admin/reviews');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
