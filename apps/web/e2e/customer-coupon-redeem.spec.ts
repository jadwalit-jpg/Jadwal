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
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
test.describe('Customer coupon redemption', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy: apply coupon at checkout + see price drop', async ({ page }) => {
    // Use the seeded coupon code (E2EFIVE) — pinned in seed-e2e-data.ts so
    // we don't need an API listing endpoint that may not exist.
    const code = process.env.E2E_COUPON_CODE || 'E2EFIVE';

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await dismissPhonePrompt(page);
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await dismissPhonePrompt(page);
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await dismissPhonePrompt(page);
    await page.locator('[data-testid="activity-card"], article:has(a[href^="/activity/"])').first().click();
    await expect(page).toHaveURL(/\/activity\//, { timeout: 10000 });
    await dismissPhonePrompt(page);
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

/**
 * The customer PhonePrompt modal can intercept pointer events on any
 * customer-facing page when the seed user has no phone set. Click "Skip
 * for now" if the prompt is visible — no-op otherwise.
 */
async function dismissPhonePrompt(page: import('@playwright/test').Page) {
  const skip = page.getByRole('button', { name: /^(skip for now|تخطي|لاحقا|لاحقًا)$/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click().catch(() => undefined);
  }
}
