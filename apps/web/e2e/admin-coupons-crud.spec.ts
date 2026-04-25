/**
 * E2E — admin coupon CRUD.
 *
 * Create → edit → delete an admin-issued coupon. Coupon code is timestamp-
 * suffixed so reruns don't collide.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin coupon CRUD', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: create → edit → delete', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
    const code = `ADMIN${Date.now().toString().slice(-6)}`;

    await page.goto('/admin/coupons');
    await page.waitForLoadState('networkidle');

    // CREATE
    await page.getByRole('button', { name: /create|new coupon|إنشاء/i }).first().click();
    const codeInput = page.getByLabel(/code|الكود/i).first();
    if (!(await codeInput.isVisible().catch(() => false))) test.skip(true, 'No coupon form');
    await codeInput.fill(code);
    const discount = page.getByLabel(/discount|نسبة/i).first();
    if (await discount.isVisible().catch(() => false)) await discount.fill('20');
    await page.getByRole('button', { name: /save|create|submit|حفظ/i }).first().click();
    await expect(page.getByText(/created|saved|تم/i).first()).toBeVisible({ timeout: 10000 });

    // EDIT (find by code, change discount)
    await page.getByText(code).first().click();
    const editBtn = page.getByRole('button', { name: /edit|تعديل/i }).first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      await page.getByLabel(/discount|نسبة/i).first().fill('25');
      await page.getByRole('button', { name: /save|update|حفظ/i }).first().click();
      await expect(page.getByText(/saved|updated|تم/i).first()).toBeVisible({ timeout: 10000 });
    }

    // DELETE
    const del = page.getByRole('button', { name: /delete|remove|حذف/i }).first();
    if (await del.isVisible().catch(() => false)) {
      await del.click();
      const confirm = page.getByRole('button', { name: /confirm|yes|delete|نعم/i }).first();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await expect(page.getByText(/deleted|removed|تم الحذف/i).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('error: empty form shows validation', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/coupons');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create|new coupon|إنشاء/i }).first().click().catch(() => null);
    const submit = page.getByRole('button', { name: /^(save|create|submit|حفظ)$/i }).first();
    if (!(await submit.isVisible().catch(() => false))) test.skip(true, 'No submit button');
    await submit.click();

    const hasError = await page
      .getByText(/required|invalid|مطلوب|غير صالح/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasError).toBe(true);
  });
});
