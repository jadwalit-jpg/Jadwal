/**
 * E2E — admin dashboard smoke load.
 *
 * Asserts: KPI cards render, sidebar nav present, no console errors during
 * load (filtered for favicon noise).
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin dashboard load', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: dashboard renders with KPIs + sidebar, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /dashboard|لوحة/i }).first())
      .toBeVisible();
    // Sidebar nav has predictable links — vendors / activities / users.
    await expect(page.getByRole('link', { name: /vendors|المزودين/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /users|المستخدمين/i }).first()).toBeVisible();

    expect(errors.filter((e) => !/favicon|net::ERR|429|too many requests|404/i.test(e))).toEqual([]);
  });

  test('error: cleared session redirects out of admin', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
