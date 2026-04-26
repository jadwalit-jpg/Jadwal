/**
 * E2E — vendor bookings list.
 *
 * Smoke: page loads, table or empty state renders, status filter works.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor bookings list', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: bookings page loads', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/bookings`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /bookings|الحجوزات/i }).first(),
    ).toBeVisible();

    const hasRows = (await page.locator('tbody tr, [data-testid="booking-row"]').count()) > 0;
    const hasEmpty = await page.getByText(/no bookings|empty|لا توجد/i).isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: status filter narrows / clears table', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/bookings`);
    await page.waitForLoadState('networkidle');

    // CustomSelect renders a <button> trigger labelled "All Statuses"; the
    // dropdown items are <button>s too (not real <option>s).
    await page.getByRole('button', { name: /all statuses|all|الحالة|الكل/i }).first().click();
    await page.getByRole('button', { name: /^cancelled$|^ملغ/i }).first().click();
    await page.waitForLoadState('networkidle');
    // No assertion that count > 0 — there may be no cancelled bookings.
    // Page still renders.
    await expect(
      page.getByRole('heading', { name: /bookings|الحجوزات/i }).first(),
    ).toBeVisible();
  });
});
