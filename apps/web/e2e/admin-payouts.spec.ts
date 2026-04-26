/**
 * E2E — admin payouts hub (two tabs: "Payments" + "Payout Requests").
 *
 * Default active tab is "Payments" (resolveInitialTab branches off
 * URL ?tab= search param).
 */
import { test, expect } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
test.describe('Admin payouts hub', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: payouts page renders heading + both tabs', async ({ page }) => {
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /payouts|الدفعات/i }).first())
      .toBeVisible();
    // Tab labels — exact strings from src/app/admin/payouts/page.tsx TABS const.
    await expect(page.getByRole('button', { name: /^payments$|المدفوعات/i }).first())
      .toBeVisible();
    await expect(page.getByRole('button', { name: /payout requests|طلبات/i }).first())
      .toBeVisible();
  });

  test('error: switching to Payout Requests tab keeps page rendering', async ({ page }) => {
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /payout requests|طلبات/i }).first().click();
    await expect(page.getByRole('heading', { name: /payouts|الدفعات/i }).first())
      .toBeVisible();
  });
});
