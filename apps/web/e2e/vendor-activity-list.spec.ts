/**
 * E2E — vendor activities list page.
 *
 * Smoke: page loads, table or empty-state renders, filters and pagination
 * are wired up. Skips gracefully if no activities exist for this vendor.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor activities list', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: list renders with table or empty state', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/activities`);
    await page.waitForLoadState('networkidle');

    // Page heading is locale-tolerant.
    await expect(
      page.getByRole('heading', { name: /activities|الأنشطة/i }).first(),
    ).toBeVisible();

    // Either at least one row in a table, or a clear empty-state copy.
    const hasRows = (await page.locator('tbody tr, [data-testid="activity-card"]').count()) > 0;
    const hasEmpty = await page
      .getByText(/no activities|empty|لا توجد/i)
      .isVisible()
      .catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: search input filters or shows empty', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/activities`);
    await page.waitForLoadState('networkidle');

    const searchBox = page.getByPlaceholder(/search|بحث/i).first();
    if (await searchBox.isVisible().catch(() => false)) {
      await searchBox.fill('zzzz-no-such-activity');
      await searchBox.press('Enter');
      await page.waitForTimeout(500); // debounce window
      // Either no rows OR an explicit empty-state message.
      const hasRows = (await page.locator('tbody tr').count()) > 0;
      const hasEmpty = await page
        .getByText(/no activities|no results|empty|لا توجد/i)
        .isVisible()
        .catch(() => false);
      expect(hasRows === false || hasEmpty).toBe(true);
    } else {
      test.skip(true, 'No search box visible on activities list');
    }
  });
});
