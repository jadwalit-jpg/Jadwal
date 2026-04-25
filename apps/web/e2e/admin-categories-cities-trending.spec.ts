/**
 * E2E — combined smoke for the 3 reference-data admin pages:
 *   /admin/categories, /admin/cities, /admin/trending.
 *
 * One file covers all three to share scaffolding cost. Each page should
 * load, render its heading, and not throw console errors.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

const PAGES = [
  { path: '/admin/categories', heading: /categories|الفئات/i },
  { path: '/admin/cities',     heading: /cities|المدن/i },
  { path: '/admin/trending',   heading: /trending|الرائج/i },
] as const;

test.describe('Admin reference-data pages', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  for (const p of PAGES) {
    test(`happy: ${p.path} loads cleanly`, async ({ page }) => {
      test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await page.goto(p.path);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: p.heading }).first()).toBeVisible();

      const hasRows = (await page.locator('tbody tr').count()) > 0;
      const hasEmpty = await page
        .getByText(/empty|no records|no items|لا يوجد|لا توجد/i)
        .isVisible()
        .catch(() => false);
      expect(hasRows || hasEmpty).toBe(true);

      expect(errors.filter((e) => !/favicon|net::ERR/i.test(e))).toEqual([]);
    });
  }
});
