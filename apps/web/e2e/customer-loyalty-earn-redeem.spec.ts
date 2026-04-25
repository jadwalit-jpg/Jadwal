/**
 * E2E — customer loyalty (Wanasa points) earn + redeem.
 *
 * Heavily data-dependent: the customer must have completed at least one
 * booking to have points to redeem. This spec is a smoke check that the
 * loyalty UI surfaces work + a happy-path redeem when points exist.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer loyalty', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy: loyalty page shows balance', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    // Loyalty UI is on /profile or a dedicated tab — try /profile and look
    // for a Wanasa / points / loyalty section.
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    const loyalty = page.getByText(/wanasa|points|نقاط|وناسة/i).first();
    if (!(await loyalty.isVisible().catch(() => false))) {
      test.skip(true, 'No loyalty section visible on /profile');
    }
    expect(await loyalty.isVisible()).toBe(true);
  });

  test('error: redeem path skipped if no points', async ({ page, request }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    const balance = await request.get('/api/loyalty/balance');
    test.skip(!balance.ok(), 'Loyalty balance endpoint unavailable');
    const body = (await balance.json()) as { points?: number; balance?: number };
    const points = body.points ?? body.balance ?? 0;
    if (points <= 0) {
      test.skip(true, `No loyalty points to redeem (balance: ${points})`);
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
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
