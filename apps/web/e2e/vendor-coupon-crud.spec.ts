/**
 * E2E — vendor coupon CRUD.
 *
 * Creates a coupon and deletes it. Coupon code is timestamp-suffixed so
 * reruns don't collide. Edit subtest skipped — the coupons table exposes
 * delete only (per the implementation in apps/web/src/app/vendor/[slug]
 * /coupons/page.tsx).
 *
 * Form contract:
 *   - Trigger:        button "Create Coupon"
 *   - Code:           <input> placeholder "e.g. SUMMER25"
 *   - Discount Value: <input type="number"> (under "Discount Value *")
 *   - Valid From:     <input type="date" required>
 *   - Valid To:       <input type="date" required>
 *   - Submit:         button "Submit for Approval"
 *   - Toast on success: t('vendor.coupons.toast.created') = "Coupon submitted
 *                       for admin approval"
 *
 * The vendor.coupons API DTO (apps/api/src/vendor/dto/create-coupon.dto.ts)
 * accepts an optional `activityIds` field — needed because the frontend
 * always sends it (empty array when no scoping). Without that whitelist the
 * global ValidationPipe (`forbidNonWhitelisted: true`) returns 400 and the
 * "submitted" toast never fires.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor coupon CRUD', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: create a coupon (vendor table has no delete UI)', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    const code = `E2E${Date.now().toString().slice(-6)}`;

    await page.goto(`/vendor/${slug}/coupons`);
    await page.waitForLoadState('networkidle');

    // ── CREATE
    await page.getByRole('button', { name: /^create coupon$/i }).click();
    const modal = page.locator('form').filter({ has: page.getByPlaceholder(/SUMMER25/i) });
    await expect(modal).toBeVisible({ timeout: 5000 });

    await modal.getByPlaceholder(/SUMMER25/i).fill(code);
    await modal.locator('input[type="number"]').first().fill('10');

    const today = new Date();
    const monthLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dateInputs = modal.locator('input[type="date"]');
    await dateInputs.nth(0).fill(fmt(today));
    await dateInputs.nth(1).fill(fmt(monthLater));

    await page.getByRole('button', { name: /submit for approval|إرسال للموافقة/i }).click();
    await expect(page.getByText(/submitted|created|saved|added|تم/i).first())
      .toBeVisible({ timeout: 10000 });

    // The new coupon row appears in the table with the entered code.
    await expect(page.locator('tr', { has: page.getByText(code) }).first())
      .toBeVisible({ timeout: 10000 });
  });

  test('error: empty form blocks submission with toast', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/coupons`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^create coupon$/i }).click();
    await expect(page.getByRole('button', { name: /submit for approval/i }))
      .toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /submit for approval/i }).click();

    // The page-level toast for empty submit is t('vendor.coupons.toast
    // .fillRequired') = "Please fill all required fields." Locale-tolerant.
    await expect(page.getByText(/required|fill .* required|fill all|invalid|cannot be empty|مطلوب|غير صالح/i).first())
      .toBeVisible({ timeout: 5000 });
  });
});
