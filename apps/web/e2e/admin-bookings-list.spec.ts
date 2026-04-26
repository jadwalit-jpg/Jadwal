/**
 * E2E — admin bookings list.
 *
 * Smoke: page loads, status filter works.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin bookings list', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: bookings page loads', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page.getByText(/no bookings|empty|لا توجد/i).isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: filter by status keeps page rendering', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');

    // Custom dropdown: open by clicking the trigger button labelled
    // "All Statuses" (or whatever the current value is), then click the
    // "Cancelled" option (also a <button>, not a real <option>).
    await page.getByRole('button', { name: /all statuses|all|الجميع|الكل|status|الحالة/i }).first().click();
    await page.getByRole('button', { name: /^cancelled$|^ملغ/i }).first().click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();
  });
});
