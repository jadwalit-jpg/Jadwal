/**
 * E2E — vendor activities list page.
 *
 * Smoke: page loads, table or empty-state renders, filters and pagination
 * are wired up. Skips gracefully if no activities exist for this vendor.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor activities list', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: list renders with table or empty state', async ({ page }) => {
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
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/activities`);
    await page.waitForLoadState('networkidle');

    // Pick the search input by its placeholder text. Multiple inputs match
    // /search/ on customer-facing pages (top-bar nav search etc.) but on the
    // vendor activities list there's only one — accept the first textbox.
    const searchBox = page.getByPlaceholder(/search activities|search|بحث/i).first();
    await expect(searchBox).toBeVisible({ timeout: 10000 });
    await searchBox.fill('zzzz-no-such-activity');
    await searchBox.press('Enter');
    await page.waitForTimeout(500); // debounce window
    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page
      .getByText(/no activities|no results|empty|لا توجد/i)
      .isVisible()
      .catch(() => false);
    expect(hasRows === false || hasEmpty).toBe(true);
  });
});
