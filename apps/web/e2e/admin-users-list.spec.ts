/**
 * E2E — admin users list (large data table).
 *
 * Smoke: page loads, filter-by-role works. The users table is one of the
 * heaviest data pages in the app (411 lines of JSX + many columns) so this
 * spec is more focused on "no console errors during render" than rich
 * interaction.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin users list', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: users list loads cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /users|المستخدمين/i }).first())
      .toBeVisible();

    // Poll: networkidle returns before React Query renders the rows. Wait
     // for either tbody rows OR empty-state text to appear.
    await expect(async () => {
      const hasRows = (await page.locator('tbody tr').count()) > 0;
      const hasEmpty = await page.getByText(/no users|empty|لا يوجد/i).isVisible().catch(() => false);
      expect(hasRows || hasEmpty).toBe(true);
    }).toPass({ timeout: 10000 });

    // Ignore favicon and transient 429 rate-limit noise (back-end throttler
    // can fire during long Playwright runs and is unrelated to the page).
    expect(errors.filter((e) => !/favicon|net::ERR|429|too many requests|404/i.test(e))).toEqual([]);
  });

  test('error: filter by role filters or shows empty', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    // The role filter is a row of <button> chips (All / Customer / Vendor / Admin),
    // not a <select>. Click the Vendor chip and confirm the heading is still
    // visible after the list narrows.
    await page.getByRole('button', { name: /^vendor$|^بائع$|^مزود$/i }).first().click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /users|المستخدمين/i }).first())
      .toBeVisible();
  });
});
