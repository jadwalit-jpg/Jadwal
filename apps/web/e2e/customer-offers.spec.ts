/**
 * E2E — customer browses /offers (active coupons + promos).
 *
 * Public page (no auth required); the seeded E2EFIVE coupon should be
 * visible if it's APPROVED + currently valid.
 */
import { test, expect } from '@playwright/test';

test.describe('Customer offers page', () => {
  test('happy: offers page renders heading + at least one offer or empty state', async ({ page }) => {
    await page.goto('/offers');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /offers|coupons|عروض|كوبونات/i }).first())
      .toBeVisible();

    const hasCards = (await page.locator('article, [data-testid="offer-card"], [class*="rounded"][class*="border"]').count()) > 0;
    const hasEmpty = await page.getByText(/no offers|no coupons|coming soon|لا يوجد|لا توجد/i).first().isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBe(true);
  });

  test('error: language toggle does not crash the page', async ({ page }) => {
    await page.context().addCookies([{ name: 'jadwal_lang', value: 'ar', url: 'http://localhost:3000' }]);
    await page.goto('/offers');
    await page.waitForLoadState('networkidle');
    // dir=rtl on <html> is the success criterion for the AR locale.
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir).toBe('rtl');
  });
});
