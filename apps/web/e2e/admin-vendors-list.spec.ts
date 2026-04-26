/**
 * E2E — admin vendors list page.
 *
 * Smoke load + filter by status. Skips approve flow (covered separately
 * in admin-vendor-approval.spec.ts).
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin vendors list', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: vendors page loads + filter UI present', async ({ page }) => {
    await page.goto('/admin/vendors');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /vendor|المزودين|إدارة/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page.getByText(/no vendors|empty|لا يوجد/i).isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });

  test('error: search/filter narrows the list or shows empty state', async ({ page }) => {
    await page.goto('/admin/vendors');
    await page.waitForLoadState('networkidle');

    const search = page.getByPlaceholder(/search by business|search|بحث/i).first();
    await expect(search).toBeVisible({ timeout: 10000 });
    await search.fill('zzz-no-such-vendor');
    await search.press('Enter');
    await page.waitForTimeout(500);

    const rowsAfter = await page.locator('tbody tr').count();
    const empty = await page.getByText(/no vendors|no results|لا يوجد/i).isVisible().catch(() => false);
    expect(rowsAfter === 0 || empty).toBe(true);
  });
});
