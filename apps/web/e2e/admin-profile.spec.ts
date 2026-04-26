/**
 * E2E — admin profile page (account info + change password).
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin profile', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: profile page renders Profile Information + Change Password sections', async ({ page }) => {
    await page.goto('/admin/profile');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /admin profile|profile|الحساب/i }).first())
      .toBeVisible();
    await expect(page.getByRole('heading', { name: /profile information|معلومات/i }).first())
      .toBeVisible();
    await expect(page.getByRole('heading', { name: /change password|تغيير كلمة/i }).first())
      .toBeVisible();
  });

  test('error: cleared session redirects', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/admin/profile');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
