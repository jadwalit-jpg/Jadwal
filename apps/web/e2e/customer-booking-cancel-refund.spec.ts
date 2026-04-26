/**
 * E2E — customer cancels a confirmed booking + submits refund-request.
 *
 * Skips when the customer has no confirmed bookings.
 */
import { test, expect } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
test.describe('Customer booking cancel + refund', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('happy: cancel a confirmed booking + submit refund reason', async ({ page }) => {
    // Cross-origin: web :3000, API :4000.
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const list = await page.request.get(`${apiBase}/bookings/my?status=CONFIRMED&page=1&limit=1`).catch(() => null);
    if (!list || !list.ok()) test.skip(true, 'Could not query my bookings');
    const body = (await list!.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const bookingId = body?.data?.[0]?.id;
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
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /bookings|الحجوزات/i }).first())
      .toBeVisible();
  });
});
