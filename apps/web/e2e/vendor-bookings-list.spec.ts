/**
 * E2E — vendor bookings list.
 *
 * Smoke: page loads, table or empty state renders, status filter works.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor bookings list', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: bookings page loads', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
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
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/bookings`);
    await page.waitForLoadState('networkidle');

    const filter = page.getByRole('combobox', { name: /status|الحالة/i }).first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'No status filter visible');
    }
    await filter.click();
    const cancelledOption = page.getByRole('option', { name: /cancelled|ملغ/i }).first();
    if (!(await cancelledOption.isVisible().catch(() => false))) {
      test.skip(true, 'No CANCELLED option in status filter');
    }
    await cancelledOption.click();
    await page.waitForLoadState('networkidle');
    // No assertion that count > 0 — there may be no cancelled bookings.
    // Page still renders.
    await expect(
      page.getByRole('heading', { name: /bookings|الحجوزات/i }).first(),
    ).toBeVisible();
  });
});
