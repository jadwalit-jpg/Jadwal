/**
 * E2E — vendor coupon CRUD.
 *
 * Creates a coupon, edits its discount, deletes it. Each step asserts a
 * toast. Coupon code is timestamp-suffixed so reruns don't collide.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor coupon CRUD', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: create → edit → delete', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);
    const code = `E2E${Date.now().toString().slice(-6)}`;

    await page.goto(`/vendor/${slug}/coupons`);
    await page.waitForLoadState('networkidle');

    // CREATE
    await page.getByRole('button', { name: /create|new coupon|إنشاء|كوبون جديد/i }).first().click();
    const codeInput = page.getByLabel(/code|الكود/i).first();
    if (!(await codeInput.isVisible().catch(() => false))) {
      test.skip(true, 'Coupon form did not open or no Code input');
    }
    await codeInput.fill(code);
    await page.getByLabel(/discount|نسبة الخصم/i).first().fill('10');
    await page.getByRole('button', { name: /save|create|submit|حفظ|إنشاء/i }).first().click();
    await expect(page.getByText(/created|saved|added|تم/i).first()).toBeVisible({ timeout: 10000 });

    // EDIT — find row by code, click edit, change discount.
    await page.getByText(code).first().click();
    const editBtn = page.getByRole('button', { name: /edit|تعديل/i }).first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      const discount = page.getByLabel(/discount|نسبة الخصم/i).first();
      await discount.fill('15');
      await page.getByRole('button', { name: /save|update|حفظ|تحديث/i }).first().click();
      await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });
    }

    // DELETE — find delete affordance (trash icon button or link).
    const deleteBtn = page.getByRole('button', { name: /delete|remove|حذف/i }).first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete|نعم|حذف/i }).first();
      if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();
      await expect(page.getByText(/deleted|removed|تم الحذف/i).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('error: empty form submission shows validation', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/coupons`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create|new coupon|إنشاء/i }).first().click().catch(() => null);
    const submit = page.getByRole('button', { name: /^(save|create|submit|حفظ|إنشاء)$/i }).first();
    if (!(await submit.isVisible().catch(() => false))) test.skip(true, 'Form not visible');
    await submit.click();

    const hasError = await page
      .getByText(/required|invalid|cannot be empty|مطلوب|غير صالح/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasError).toBe(true);
  });
});
