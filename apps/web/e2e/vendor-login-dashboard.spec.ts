/**
 * E2E — vendor login → dashboard.
 *
 * Smoke check that the vendor storageState works and the dashboard
 * renders its critical chrome (sidebar, stat cards, no console errors).
 *
 * Pre-req: vendor seeded via
 *   docker compose exec -T api npx tsx prisma/seed-e2e-vendor.ts
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor login + dashboard', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: vendor lands on dashboard with sidebar + KPI cards', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`/vendor/${slug}/dashboard`);
    await page.waitForLoadState('networkidle');

    // Sidebar nav has multiple items; assert at least one well-known link.
    await expect(
      page.getByRole('link', { name: /activities|الأنشطة/i }).first(),
    ).toBeVisible();
    // KPI cards rendered — assert on their labels (content), not CSS classes
    // (the cards are borderless rounded+shadow, so a [class*=border] selector
    // misses them). A waited assertion also rides out the client-side query that
    // populates the numbers after networkidle.
    await expect(
      page
        .getByText(/total bookings|bookings value|revenue|total activities|إجمالي/i)
        .first(),
    ).toBeVisible({ timeout: 10000 });

    // Lighthouse-style "no JS errors during load"
    expect(errors.filter((e) => !/favicon|net::ERR|429|too many requests|404/i.test(e))).toEqual([]);
  });

  test('error: cleared session redirects out of vendor area', async ({ page, context }) => {
    const slug = await vendorSlugFromMe(page);
    await context.clearCookies();
    await page.goto(`/vendor/${slug}/dashboard`);
    // The middleware redirects unauthenticated /vendor/* requests to
    // /register/vendor (the vendor onboarding entry). Accept any of the
    // auth-gate destinations the app currently uses.
    await expect(page).toHaveURL(/\/(login|admin\/login|register\/vendor)/, { timeout: 10000 });
  });
});
