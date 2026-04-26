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

    // Settings inputs use <label> without htmlFor — locate by name=.
    const aboutInput = page.locator('textarea[name="aboutText"]').first();
    await expect(aboutInput).toBeVisible({ timeout: 10000 });
    const newAbout = `E2E test about ${Date.now()}`;
    await aboutInput.fill(newAbout);

    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(aboutInput).toHaveValue(newAbout);
  });

  test('error: settings page heading visible', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /settings|الإعدادات/i }).first())
      .toBeVisible();
  });
});
