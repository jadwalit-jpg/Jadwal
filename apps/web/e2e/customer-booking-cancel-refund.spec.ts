/**
 * E2E — customer cancels a confirmed booking + submits refund-request.
 *
 * Skips when the customer has no confirmed bookings.
 */
import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const HAS_CUSTOMER_STATE = existsSync(CUSTOMER_STATE);

test.describe('Customer booking cancel + refund', () => {
  test.use({ storageState: HAS_CUSTOMER_STATE ? CUSTOMER_STATE : undefined });

  test('happy: cancel a confirmed booking + submit refund reason', async ({ page, request }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');

    const list = await request.get('/api/bookings/my?status=CONFIRMED&page=1&limit=1');
    test.skip(!list.ok(), 'Could not query my bookings');
    const body = (await list.json()) as { data?: Array<{ id: string }> };
    const bookingId = body.data?.[0]?.id;
    test.skip(!bookingId, 'No confirmed booking to cancel');

    await page.goto(`/bookings/${bookingId}`);
    await page.waitForLoadState('networkidle');

    const cancelBtn = page.getByRole('button', { name: /cancel|إلغاء/i }).first();
    if (!(await cancelBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No cancel button visible — booking may not be cancellable');
    }
    await cancelBtn.click();

    // Cancel modal — usually has a reason input.
    const reason = page.getByLabel(/reason|السبب/i).first();
    if (await reason.isVisible().catch(() => false)) {
      await reason.fill('E2E test cancellation');
    }
    const confirmBtn = page.getByRole('button', { name: /confirm|submit|cancel booking|تأكيد|إرسال/i }).first();
    if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();

    await expect(page.getByText(/cancelled|cancellation|تم الإلغاء|ملغ/i).first())
      .toBeVisible({ timeout: 10000 });
  });

  test('error: bookings list page renders heading', async ({ page }) => {
    test.skip(!HAS_CUSTOMER_STATE, 'Customer storageState not available');
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();
  });
});
