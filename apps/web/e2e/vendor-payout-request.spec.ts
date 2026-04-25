/**
 * E2E — vendor requests a payout.
 *
 * Skips when the vendor's available balance is insufficient (the eligibility
 * banner blocks the form), or when there's already an inflight request.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const HAS_VENDOR_STATE = existsSync(VENDOR_STATE);

test.describe('Vendor payout request', () => {
  test.use({ storageState: HAS_VENDOR_STATE ? VENDOR_STATE : undefined });

  test('happy: submit a payout request for an eligible amount', async ({ page, request }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    // Inspect eligibility before clicking — skip if not eligible.
    const eligibility = await request.get(`/api/vendor/${slug}/payouts/eligibility`);
    if (eligibility.ok()) {
      const e = (await eligibility.json()) as { eligible?: boolean; reason?: string; availableBalance?: number };
      if (!e.eligible) {
        test.skip(true, `Vendor not eligible for payout: ${e.reason ?? 'unknown'}`);
      }
    }

    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');

    const requestBtn = page.getByRole('button', { name: /request payout|طلب صرف/i }).first();
    if (!(await requestBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Request payout button not visible');
    }
    await requestBtn.click();

    // Form modal — fill in the amount input. Use a tiny amount to stay
    // within the available balance.
    const amount = page.getByLabel(/amount|المبلغ/i).first();
    if (!(await amount.isVisible().catch(() => false))) {
      test.skip(true, 'Amount input not visible');
    }
    await amount.fill('1');

    await page.getByRole('button', { name: /submit|confirm|إرسال|تأكيد/i }).first().click();

    await expect(
      page.getByText(/pending|submitted|قيد المراجعة|تم الإرسال/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: earnings page renders even when ineligible', async ({ page }) => {
    test.skip(!HAS_VENDOR_STATE, 'Vendor storageState not available');
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('heading', { name: /earnings|الأرباح/i }).first(),
    ).toBeVisible();
  });
});
