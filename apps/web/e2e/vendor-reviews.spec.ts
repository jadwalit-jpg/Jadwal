/**
 * E2E — vendor reviews page (read-only view of customer reviews on the
 * vendor's activities).
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor reviews', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: reviews page renders heading + table or empty state', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    await page.goto(`/vendor/${slug}/reviews`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /reviews|المراجعات/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr, article').count()) > 0;
    const hasEmpty = await page.getByText(/no reviews|empty|لا يوجد|لا توجد/i).first().isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: cleared session redirects out of vendor area', async ({ page, context }) => {
    const slug = await vendorSlugFromMe(page);
    await context.clearCookies();
    await page.goto(`/vendor/${slug}/reviews`);
    await expect(page).toHaveURL(/\/(login|admin\/login|register\/vendor)/, { timeout: 10000 });
  });
});
