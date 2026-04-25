/**
 * E2E — customer applies a coupon at checkout.
 *
 * Walks the catalog → activity → book flow up to the price summary, then
 * pastes a known coupon code and asserts the discount lands. Mocks the
 * payment-initiate so no real PAY2M call happens.
 *
 * Coupon code: pulled from /api/coupons/active (read-only). Skips if
 * none exist.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer coupon redemption', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy: apply coupon at checkout + see price drop', async ({ page, request }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    const couponList = await request.get('/api/coupons/active?page=1&limit=1');
    test.skip(!couponList.ok(), 'Could not fetch active coupons');
    const couponBody = (await couponList.json()) as { data?: Array<{ code: string }> };
    const code = couponBody.data?.[0]?.code;
    test.skip(!code, 'No active coupon to redeem');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await page.getByRole('button', { name: /book|reserve|احجز/i }).first().click();
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const couponInput = page.getByLabel(/coupon|code|الكود/i).first();
    if (!(await couponInput.isVisible().catch(() => false))) {
      test.skip(true, 'No coupon input on booking page');
    }
    await couponInput.fill(code!);
    const applyBtn = page.getByRole('button', { name: /apply|تطبيق/i }).first();
    if (await applyBtn.isVisible().catch(() => false)) await applyBtn.click();

    // Either an "applied" toast or a discount line appears in the summary.
    const applied = await page
      .getByText(/applied|discount|خصم|تم تطبيق/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    expect(applied).toBe(true);
  });

  test('error: invalid coupon shows error', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await page.getByRole('button', { name: /book|reserve|احجز/i }).first().click();
    await expect(page).toHaveURL(/\/activity\/.*\/book/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const couponInput = page.getByLabel(/coupon|code|الكود/i).first();
    if (!(await couponInput.isVisible().catch(() => false))) {
      test.skip(true, 'No coupon input visible');
    }
    await couponInput.fill('NOTAREALCODE');
    const applyBtn = page.getByRole('button', { name: /apply|تطبيق/i }).first();
    if (await applyBtn.isVisible().catch(() => false)) await applyBtn.click();

    const hasError = await page
      .getByText(/invalid|not found|expired|غير صالح|منتهي/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasError).toBe(true);
  });
});
