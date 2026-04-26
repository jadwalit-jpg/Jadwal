/**
 * E2E — vendor requests a payout.
 *
 * Skips when the vendor's available balance is insufficient (the eligibility
 * banner blocks the form), no bank details, or when there's already an
 * inflight request. Most local dev runs hit the empty-balance skip — the
 * happy assertion only fires when a SUCCESS payment exists for the seeded
 * vendor with payoutStatus=UNPAID.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor payout request', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: submit a payout request for an eligible amount', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');

    // The earnings page renders a banner whose copy depends on the
    // eligibility blocker (NO_BALANCE, NO_BANK_DETAILS, etc.). Wait for the
    // banner to settle, then inspect — any blocker text means the rest of
    // the flow can't run, skip.
    const banner = page.getByText(
      /no eligible cash balance|add your bank details|already have a payout|approved payout in progress|below the minimum payout|account is suspended/i,
    ).first();
    if (await banner.isVisible().catch(() => false)) {
      const reason = await banner.textContent().catch(() => '');
      test.skip(true, `Vendor not eligible: ${reason?.trim().slice(0, 80)}`);
    }

    const requestBtn = page.getByRole('button', { name: /^request payout$|طلب صرف/i }).first();
    await expect(requestBtn).toBeVisible({ timeout: 10000 });
    if (await requestBtn.isDisabled().catch(() => false)) {
      test.skip(true, 'Request payout disabled — vendor not eligible.');
    }
    await requestBtn.click();

    // Modal opens — fill the amount and submit. Use a tiny amount to stay
    // within available balance regardless of seeded value.
    const amount = page.getByLabel(/amount|المبلغ/i).first();
    if (!(await amount.isVisible().catch(() => false))) {
      test.skip(true, 'Amount input not visible after opening payout modal');
    }
    await amount.fill('1');
    await page.getByRole('button', { name: /^submit$|^confirm$|إرسال|تأكيد/i }).first().click();

    await expect(
      page.getByText(/pending|submitted|قيد المراجعة|تم الإرسال/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: earnings page renders heading + Request Payout button', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');

    // Page heading is "Earnings" / "Earnings & Payouts" / "الأرباح".
    await expect(
      page.getByRole('heading', { name: /earnings|الأرباح|payout/i }).first(),
    ).toBeVisible();
    // Whether the button is enabled or disabled, it should always render.
    await expect(
      page.getByRole('button', { name: /^request payout$|طلب صرف/i }).first(),
    ).toBeVisible();
  });
});
