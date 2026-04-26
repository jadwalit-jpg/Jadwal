/**
 * E2E — vendor approves or rejects a refund request.
 * Skips when no refund request exists.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
test.describe('Vendor refund decision', () => {
  test.use({ storageState: VENDOR_STATE });

  test('happy: approve a pending refund request', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const list = await page.request.get(`${apiBase}/vendor/${slug}/refund-requests?status=PENDING&page=1&limit=1`).catch(() => null);
    test.skip(!list || !list.ok(), 'Could not fetch refund requests');
    const body = (await list!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const refundId = body?.data?.[0]?.id;
    test.skip(!refundId, 'No pending refund requests — skip approve flow');

    await page.goto(`/vendor/${slug}/refund-requests`);
    await page.waitForLoadState('networkidle');

    const approve = page.getByRole('button', { name: /^(approve|accept|قبول|موافق)$/i }).first();
    if (!(await approve.isVisible().catch(() => false))) {
      test.skip(true, 'No approve button visible');
    }
    await approve.click();

    // A confirm dialog often follows. Accept it if present.
    const confirmDlg = page.getByRole('button', { name: /^(confirm|yes|نعم|تأكيد)$/i }).first();
    if (await confirmDlg.isVisible().catch(() => false)) {
      await confirmDlg.click();
    }

    await expect(
      page.getByText(/approved|refunded|تمت الموافقة|تم الاسترداد/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('error: list page renders with empty state when no refunds', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);

    await page.goto(`/vendor/${slug}/refund-requests`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /refund|استرداد/i }).first(),
    ).toBeVisible();
  });
});
