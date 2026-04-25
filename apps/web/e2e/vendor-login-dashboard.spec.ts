/**
 * E2E — vendor login → dashboard.
 *
 * Smoke check that the vendor storageState works and the dashboard
 * renders its critical chrome (sidebar, stat cards, no console errors).
 *
 * Pre-req: vendor seeded via
 *   docker compose exec -T api npx tsx prisma/seed-e2e-vendor.ts
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor login + dashboard', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: vendor lands on dashboard with sidebar + KPI cards', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');

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
    // KPI cards or empty-state — either is acceptable for a smoke test.
    const hasKpi = await page
      .locator('[class*="rounded"][class*="border"]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasKpi).toBe(true);

    // Lighthouse-style "no JS errors during load"
    expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
  });

  test('error: cleared session redirects out of vendor area', async ({ page, context }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);
    await context.clearCookies();
    await page.goto(`/vendor/${slug}/dashboard`);
    // Either bounced to /login or the vendor login flow — both indicate
    // the auth gate triggered.
    await expect(page).toHaveURL(/\/(login|admin\/login)/, { timeout: 10000 });
  });
});
