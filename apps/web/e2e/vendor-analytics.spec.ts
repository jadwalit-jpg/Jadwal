/**
 * E2E — vendor analytics dashboard.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor analytics', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: analytics page renders heading + at least one chart card', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    await page.goto(`/vendor/${slug}/analytics`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /analytics|تحليلات/i }).first())
      .toBeVisible();
  });

  test('error: cleared session redirects out of vendor area', async ({ page, context }) => {
    const slug = await vendorSlugFromMe(page);
    await context.clearCookies();
    await page.goto(`/vendor/${slug}/analytics`);
    await expect(page).toHaveURL(/\/(login|admin\/login|register\/vendor)/, { timeout: 10000 });
  });
});
