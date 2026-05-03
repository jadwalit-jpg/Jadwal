/**
 * E2E — i18n + RTL: setting the jadwal_lang=ar cookie flips the doc to
 * Arabic with dir="rtl" on the key public pages. Replaces ad-hoc visual
 * RTL coverage with assertion-based checks that catch broken layout
 * (overflow, dir mismatch) before staging.
 */
import { test, expect } from '@playwright/test';

const PAGES = [
  '/',
  '/explore',
  '/login',
];

test.describe('i18n / RTL — Arabic locale on key public pages', () => {
  test.beforeEach(async ({ context }) => {
    // Force Arabic via the language cookie before any page load. Setting
    // the cookie at the context level applies to every page.goto in this
    // test.
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
    const url = new URL(baseURL);
    await context.addCookies([{
      name: 'jadwal_lang',
      value: 'ar',
      domain: url.hostname,
      path: '/',
      httpOnly: false,
      secure: url.protocol === 'https:',
    }]);
  });

  for (const route of PAGES) {
    test(`${route} renders with dir="rtl" lang="ar" and no horizontal overflow`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');

      const html = page.locator('html');
      await expect(html).toHaveAttribute('dir', 'rtl');
      await expect(html).toHaveAttribute('lang', 'ar');

      // No horizontal overflow on Arabic layouts.
      const overflow = await page.evaluate(() => ({
        docWidth: document.documentElement.scrollWidth,
        viewWidth: window.innerWidth,
      }));
      expect(overflow.docWidth).toBeLessThanOrEqual(overflow.viewWidth + 2);
    });
  }
});
