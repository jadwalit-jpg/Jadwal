/**
 * E2E — admin coupon CRUD.
 *
 * Create → delete an admin platform coupon. Coupon code is timestamp-
 * suffixed so reruns don't collide. Edit subtest skipped — admin coupons
 * page has no in-row edit affordance, only delete.
 *
 * Form contract (apps/web/src/app/admin/coupons/page.tsx):
 *   - Trigger:        button "Create Platform Coupon"
 *   - Code:           <input> with placeholder "e.g. SUMMER2025"
 *   - Discount value: <input name="discountValue"> (default 0 — must override)
 *   - Valid From:     <input name="validFrom" type="date">
 *   - Valid To:       <input name="validTo" type="date">
 *   - Submit:         button "Create Coupon"
 *   - Toast on success: "Coupon created" (or similar — match /created|added/i)
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin coupon CRUD', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: create + delete a platform coupon', async ({ page }) => {
    const code = `ADMIN${Date.now().toString().slice(-6)}`;

    await page.goto('/admin/coupons');
    await page.waitForLoadState('networkidle');

    // ── CREATE
    await page.getByRole('button', { name: /create platform coupon/i }).click();
    await expect(page.getByRole('heading', { name: /create platform coupon/i })).toBeVisible({ timeout: 5000 });

    // Modal-scoped: code input is the only [placeholder*="SUMMER"] on the page.
    await page.getByPlaceholder(/SUMMER/i).fill(code);
    // Discount value defaults to 0 — overwrite with 20.
    await page.locator('input[name="discountValue"]').fill('20');

    // Date inputs (HTML5 type="date").
    const today = new Date();
    const monthLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await page.locator('input[name="validFrom"]').fill(fmt(today));
    await page.locator('input[name="validTo"]').fill(fmt(monthLater));

    // The submit is the only button labelled exactly "Create Coupon" (the
    // trigger says "Create Platform Coupon"). Match exactly to avoid the trigger.
    await page.getByRole('button', { name: /^create coupon$|^creating/i }).click();
    await expect(page.getByText(/created|added|submitted/i).first()).toBeVisible({ timeout: 10000 });

    // ── DELETE the row we just created.
    const row = page.locator('tr', { has: page.getByText(code) }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.getByRole('button', { name: /delete coupon|delete|حذف/i }).first().click();
    // Confirmation modal — click the red "Delete" CTA, not the "Cancel".
    await page.getByRole('button', { name: /^delete$|delete coupon/i }).last().click();
    await expect(page.getByText(/deleted|removed|تم الحذف/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('error: empty form blocks submission via HTML5 required', async ({ page }) => {
    await page.goto('/admin/coupons');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create platform coupon/i }).click();
    const submit = page.getByRole('button', { name: /^create coupon$/i });
    await expect(submit).toBeVisible({ timeout: 5000 });

    // Click submit with all fields empty. Required HTML5 validation OR the
    // page-level toast ("Coupon code must be at least 3 characters") fires —
    // either is correct UX. Just assert that no "created" toast appears.
    await submit.click();
    const created = await page
      .getByText(/created|added|submitted/i)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    expect(created).toBe(false);
  });
});
