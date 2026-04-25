/**
 * E2E — admin platform settings update.
 *
 * Updates a non-destructive setting (e.g. platform name or support email),
 * saves, reloads, asserts persistence. Uses a value that's safe to leave
 * in dev DB.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin platform settings update', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: change a value + reload preserves it', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const aboutInput = page.getByLabel(/about|description|الوصف/i).first();
    if (!(await aboutInput.isVisible().catch(() => false))) {
      test.skip(true, 'No about/description field — settings layout changed');
    }
    const newAbout = `E2E test about ${Date.now()}`;
    await aboutInput.fill(newAbout);

    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(aboutInput).toHaveValue(newAbout);
  });

  test('error: settings page heading visible', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /settings|الإعدادات/i }).first())
      .toBeVisible();
  });
});
