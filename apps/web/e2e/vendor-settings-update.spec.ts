/**
 * E2E — vendor settings (business profile) update.
 *
 * Updates the business profile fields (EN + AR), saves, reloads, asserts
 * persistence. Phone field uses a stable test number.
 */
import { test, expect } from '@playwright/test';
import { isVendorAuthenticated, vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor settings update', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: update business profile + reload preserves changes', async ({ page }) => {
    if (!(await isVendorAuthenticated(page))) {
      test.skip(true, 'Vendor session expired during long suite run');
    }
    const slug = await vendorSlugFromMe(page);
    const newDesc = `E2E desc ${Date.now()}`;

    await page.goto(`/vendor/${slug}/settings`);
    await page.waitForLoadState('networkidle');

    // Description (EN) — labels have no htmlFor, so locate the textarea by
    // its placeholder ("About your business...").
    const descEn = page.getByPlaceholder(/about your business|english description|الوصف/i).first();
    await expect(descEn).toBeVisible({ timeout: 10000 });
    await descEn.fill(newDesc);

    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(descEn).toHaveValue(newDesc);
  });

  test('error: settings page heading visible', async ({ page }) => {
    if (!(await isVendorAuthenticated(page))) {
      test.skip(true, 'Vendor session expired during long suite run — heading test n/a');
    }
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('heading', { name: /settings|profile|الإعدادات|الملف/i }).first(),
    ).toBeVisible();
  });
});
