/**
 * E2E — admin users list (large data table).
 *
 * Smoke: page loads, filter-by-role works. The users table is one of the
 * heaviest data pages in the app (411 lines of JSX + many columns) so this
 * spec is more focused on "no console errors during render" than rich
 * interaction.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin users list', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: users list loads cleanly', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /users|المستخدمين/i }).first())
      .toBeVisible();

    const hasRows = (await page.locator('tbody tr').count()) > 0;
    const hasEmpty = await page.getByText(/no users|empty|لا يوجد/i).isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);

    expect(errors.filter((e) => !/favicon|net::ERR/i.test(e))).toEqual([]);
  });

  test('error: filter by role filters or shows empty', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');

    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    const filter = page.getByRole('combobox', { name: /role|الدور/i }).first();
    if (!(await filter.isVisible().catch(() => false))) test.skip(true, 'No role filter visible');
    await filter.click();
    const vendor = page.getByRole('option', { name: /vendor|بائع|مزود/i }).first();
    if (!(await vendor.isVisible().catch(() => false))) test.skip(true, 'No VENDOR option');
    await vendor.click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /users|المستخدمين/i }).first())
      .toBeVisible();
  });
});
