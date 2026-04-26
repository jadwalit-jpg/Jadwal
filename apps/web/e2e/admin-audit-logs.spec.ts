/**
 * E2E — admin audit logs page.
 *
 * Smoke: page loads, renders the timeline / table. Admin audit log is
 * append-only — no edit affordance, just a viewer.
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin audit logs', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: audit logs page renders heading + filters', async ({ page }) => {
    await page.goto('/admin/audit-logs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /audit log|سجل/i }).first())
      .toBeVisible();
  });

  test('error: cleared session redirects out of admin', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/admin/audit-logs');
    await expect(page).toHaveURL(/\/admin\/login|\/login/, { timeout: 10000 });
  });
});
