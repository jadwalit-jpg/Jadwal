/**
 * E2E — admin platform settings update.
 *
 * Updates a non-destructive setting (e.g. platform name or support email),
 * saves, reloads, asserts persistence. Uses a value that's safe to leave
 * in dev DB.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin platform settings update', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: change a value + reload preserves it', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // Settings inputs use <label> without htmlFor — locate by name=. The form
    // exposes platformName / supportEmail / supportPhone / pct (there is no
    // longer an aboutText field). Use supportEmail: free-form enough to write a
    // unique value, lowest blast radius (no branding / commission impact).
    const supportEmail = page.locator('input[name="supportEmail"]').first();
    await expect(supportEmail).toBeVisible({ timeout: 10000 });
    const newEmail = `e2e-support-${Date.now()}@jadwal-test.local`;
    await supportEmail.fill(newEmail);

    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(supportEmail).toHaveValue(newEmail);
  });

  test('error: settings page heading visible', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /settings|الإعدادات/i }).first())
      .toBeVisible();
  });
});
