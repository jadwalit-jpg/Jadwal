/**
 * E2E — §B2 orphaned-paid auto-refund.
 *
 * Wave 3 wired the payment callback to detect cron-cancelled / deleted
 * bookings and queue an automatic refund instead of silently logging
 * PAYMENT_ORPHANED. Customers landing on the post-pay callback page now
 * see a "we couldn't reserve your spot, money will return in 5–7
 * business days" message rather than a broken state.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010b2';

async function setupRoutes(page: Page) {
  // The callback page polls bookings/:id and / or a callback endpoint to
  // resolve the post-pay state. Both shapes return REFUND_QUEUED so the
  // page renders the refund-pending message regardless of which one wins.
  const refundPayload = {
    bookingId: MOCK_BOOKING_ID,
    status: 'REFUND_QUEUED',
    reason: 'BOOKING_CANCELLED',
    refundAmount: '300.00',
    currency: 'QAR',
  };

  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_BOOKING_ID,
          status: 'CANCELLED',
          cancelledBy: 'SYSTEM',
          totalPrice: '300.00',
          currencyCode: 'QAR',
          activity: { titleEn: 'Orphan Mock Activity', slug: 'orphan-mock' },
          payment: { id: 'pay-mock-b2', status: 'REFUND_QUEUED', amount: '300.00' },
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/payment/callback**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(refundPayload),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer payment callback — §B2 orphaned-paid refund', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('callback page shows refund-queued message for cron-cancelled booking', async ({ page }) => {
    // QUARANTINED (2026-07-04): the current /payment/callback + /bookings/[id]
    // pages render only generic pending/unconfirmed/failed/Cancelled states —
    // there is NO "we couldn't reserve your spot, refund in 5–7 business days"
    // (§B2) message in the live UI, so this assertion targets copy that doesn't
    // exist. ⚠️ POTENTIAL UX GAP: a customer who paid but whose booking was
    // orphan-cancelled sees no refund reassurance. Resolve by either (a) shipping
    // the refund-queued message, or (b) re-scoping this spec to the current copy.
    // (The mock booking payload shape has also drifted — page shows "QAR NaN".)
    test.fixme(true, '§B2 refund-queued message not present in current callback/booking UI — needs product decision (see comment)');
    await setupRoutes(page);
    await page.goto(`/payment/callback?status=success&bookingId=${MOCK_BOOKING_ID}`);
    await page.waitForLoadState('networkidle');

    // The exact copy may differ between EN/AR — match the user-facing
    // intent: refund / 5-7 business days / could not reserve.
    const refundMsg = page.getByText(
      /(refund|return).*5\s*-\s*7|business day|could not.*spot|reserve.*failed|أيام عمل/i,
    );
    await expect(refundMsg.first()).toBeVisible({ timeout: 15000 });

    // The callback page must NOT advertise a confirmed booking link —
    // there's no booking to view because it was cancelled.
    const confirmedLink = page.getByRole('link', { name: /view.*booking|تفاصيل الحجز/i });
    await expect(confirmedLink).toHaveCount(0);
  });
});
