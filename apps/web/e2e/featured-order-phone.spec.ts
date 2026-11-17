/**
 * E2E — admin "Featured order" page on a phone.
 *
 * Not prefixed `admin-` on purpose: the mobile projects ignore admin-*.spec.ts,
 * and this check only means something on a phone-sized viewport. It skips on
 * desktop projects. The fixed parts of a row used to need ~374px, which left
 * the title 0px wide on phones up to ~410px.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

test.describe('Featured order on a phone', () => {
  test.use({ storageState: ADMIN_STATE });
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('happy: the first row keeps a readable title, 44px buttons, and the page has no sideways scroll', async ({ page }) => {
    const loaded = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/admin/activities/featured'));
    await page.goto('/admin/activities/featured');
    await loaded;
    const first = page.locator('li[data-testid^="featured-row-"]').first();
    await first.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => { /* empty list: skipped below */ });
    test.skip(!(await first.isVisible().catch(() => false)), 'no featured listing in the seed');

    const title = first.getByTestId('featured-row-title').locator('p').first();
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(120);

    const name = (await title.textContent())?.trim() ?? '';
    for (const label of [`Move "${name}" up`, `Move "${name}" down`, `Remove "${name}" from featured`, `Drag to move "${name}"`]) {
      const btn = first.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
      const b = await btn.boundingBox();
      expect(b, label).not.toBeNull();
      expect(b!.width, label).toBeGreaterThanOrEqual(44);
      expect(b!.height, label).toBeGreaterThanOrEqual(44);
    }

    const noSidewaysScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(noSidewaysScroll).toBe(true);
  });
});
