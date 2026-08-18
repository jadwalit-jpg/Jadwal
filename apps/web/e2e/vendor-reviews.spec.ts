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

    // Wait for the client-side query to resolve into EITHER a review card or the
    // empty state. A synchronous count()/isVisible() races the react-query fetch,
    // which can settle after networkidle → false negative (flaky). Reviews render
    // as cards (each with a "Reply to review" button), NOT table rows/articles.
    await expect(
      page
        .getByRole('button', { name: /reply/i })
        .first()
        .or(page.getByText(/no reviews|empty|لا يوجد|لا توجد/i).first()),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: cleared session redirects out of vendor area', async ({ page, context }) => {
    const slug = await vendorSlugFromMe(page);
    await context.clearCookies();
    await page.goto(`/vendor/${slug}/reviews`);
    await expect(page).toHaveURL(/\/(login|admin\/login|register\/vendor)/, { timeout: 10000 });
  });
});
