/**
 * E2E — combined smoke for the 3 reference-data admin pages:
 *   /admin/categories, /admin/cities, /admin/trending.
 *
 * One file covers all three to share scaffolding cost. Each page should
 * load, render its heading, and not throw console errors.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const PAGES = [
  { path: '/admin/categories', heading: /categories|الفئات/i },
  { path: '/admin/cities',     heading: /cities|المدن/i },
  { path: '/admin/trending',   heading: /trending|الرائج/i },
] as const;

test.describe('Admin reference-data pages', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const p of PAGES) {
    test(`happy: ${p.path} loads cleanly`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await page.goto(p.path);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: p.heading }).first()).toBeVisible();

      // Pages may render data as table rows OR as cards (e.g. /admin/trending).
      // As a last resort accept the page's "Add X" / "New X" CTA — it's
      // present on every reference-data admin page and proves the page
      // actually rendered (vs being stuck on a skeleton).
      const hasRows = (await page.locator('tbody tr').count()) > 0;
      const hasCards = (await page.getByRole('button', { name: /^edit$/i }).count()) > 0;
      const hasEmpty = await page
        .getByText(/empty|no records|no items|no .* yet|no .* found|لا يوجد|لا توجد/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasCta = await page
        .getByRole('button', { name: /^add |^new |^create |^\+ /i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasRows || hasCards || hasEmpty || hasCta).toBe(true);

      expect(errors.filter((e) => !/favicon|net::ERR|429|too many requests|404/i.test(e))).toEqual([]);
    });
  }
});
