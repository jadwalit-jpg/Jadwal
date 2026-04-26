/**
 * E2E — admin loyalty (Wanasa) config + leaderboard page.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin loyalty (WANASA)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: loyalty page renders config + leaderboard', async ({ page }) => {
    await page.goto('/admin/loyalty');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /loyalty|wanasa|نقاط|وناسة/i }).first())
      .toBeVisible();
    await expect(page.getByRole('heading', { name: /loyalty config|points|الإعدادات|نقاط/i }).first())
      .toBeVisible();
  });

  test('error: cleared session redirects', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/admin/loyalty');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
