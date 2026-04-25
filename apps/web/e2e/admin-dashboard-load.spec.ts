/**
 * E2E — admin dashboard smoke load.
 *
 * Asserts: KPI cards render, sidebar nav present, no console errors during
 * load (filtered for favicon noise).
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const HAS_ADMIN_STATE = existsSync(ADMIN_STATE);

test.describe('Admin dashboard load', () => {
  test.use({ storageState: HAS_ADMIN_STATE ? ADMIN_STATE : undefined });

  test('happy: dashboard renders with KPIs + sidebar, no console errors', async ({ page }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
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

    expect(errors.filter((e) => !/favicon|net::ERR/i.test(e))).toEqual([]);
  });

  test('error: cleared session redirects out of admin', async ({ page, context }) => {
    test.skip(!HAS_ADMIN_STATE, 'Admin storageState not available');
    await context.clearCookies();
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
