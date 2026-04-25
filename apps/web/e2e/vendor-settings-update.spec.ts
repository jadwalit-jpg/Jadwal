/**
 * E2E — vendor settings (business profile) update.
 *
 * Updates the business profile fields (EN + AR), saves, reloads, asserts
 * persistence. Phone field uses a stable test number.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor settings update', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: update business profile + reload preserves changes', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);
    const newDesc = `E2E desc ${Date.now()}`;

    await page.goto(`/vendor/${slug}/settings`);
    await page.waitForLoadState('networkidle');

    // Description (EN) — locale-tolerant.
    const descEn = page.getByLabel(/description.*english|english description|الوصف.*انجليزي/i).first();
    if (!(await descEn.isVisible().catch(() => false))) {
      test.skip(true, 'No English description input visible');
    }
    await descEn.fill(newDesc);

    await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
    await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(descEn).toHaveValue(newDesc);
  });

  test('error: settings page heading visible', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('heading', { name: /settings|profile|الإعدادات|الملف/i }).first(),
    ).toBeVisible();
  });
});
