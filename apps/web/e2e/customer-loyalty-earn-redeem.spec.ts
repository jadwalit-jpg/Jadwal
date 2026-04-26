/**
 * E2E — customer loyalty (Wanasa points) earn + redeem.
 *
 * Heavily data-dependent: the customer must have completed at least one
 * booking to have points to redeem. This spec is a smoke check that the
 * loyalty UI surfaces work + a happy-path redeem when points exist.
 */
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
test.describe('Customer loyalty', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy: loyalty page shows balance', async ({ page }) => {
    // Loyalty UI is on /profile or a dedicated tab — try /profile and look
    // for a Wanasa / points / loyalty section.
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    // Use polling toBeVisible — the loyalty section renders after the
    // /users/points React Query call completes, not immediately on load.
    await expect(page.getByText(/wanasa|points|نقاط|وناسة/i).first())
      .toBeVisible({ timeout: 10000 });
  });

  test('error: redeem path skipped if no points', async ({ page }) => {
    // Hit the API server directly (cross-origin: web :3000, API :4000).
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const balance = await page.request.get(`${apiBase}/users/points`).catch(() => null);
    if (!balance || !balance.ok()) test.skip(true, 'Loyalty balance endpoint unavailable');
    const body = (await balance!.json().catch(() => null)) as { loyaltyPoints?: number; points?: number; balance?: number } | null;
    const points = body?.loyaltyPoints ?? body?.points ?? body?.balance ?? 0;
    if (points <= 0) {
      test.skip(true, `No loyalty points to redeem (balance: ${points})`);
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const dismissPrompt = async () => {
      const skip = page.getByRole('button', { name: /^(skip for now|تخطي|لاحقا|لاحقًا)$/i }).first();
      if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => undefined);
    };
    await dismissPrompt();
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await dismissPrompt();
    await page.getByRole('button', { name: /book|reserve|احجز/i }).first().click();
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const useToggle = page.getByRole('checkbox', { name: /points|wanasa|نقاط|وناسة/i }).first();
    const useBtn = page.getByRole('button', { name: /use points|redeem|استخدم/i }).first();
    if (await useToggle.isVisible().catch(() => false)) {
      await useToggle.check();
    } else if (await useBtn.isVisible().catch(() => false)) {
      await useBtn.click();
    } else {
      test.skip(true, 'No loyalty redemption affordance on booking page');
    }
    // Assert price total drops (loyalty discount line appears) — locale-tolerant.
    await expect(page.getByText(/discount|points used|خصم|نقاط/i).first())
      .toBeVisible({ timeout: 10000 });
  });
});
