/**
 * E2E — §B2 orphaned-paid auto-refund reassurance.
 *
 * When a customer pays but their booking was already cron-cancelled / the spot
 * became unavailable, the payment callback flips the payment to REFUND_PENDING
 * and marks the booking CANCELLED by SYSTEM (queueB2Refund). The booking detail
 * page must then reassure the customer that their money is coming back — rather
 * than the customer-cancellation framing ("your refund request is under review")
 * or a broken state. This spec mocks that end state and asserts the message.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010b2';

// The booking detail page (GET /api/bookings/my/:id) resolved to a booking that
// was auto-cancelled by SYSTEM after payment, with the payment queued for refund
// (REFUND_PENDING — the real PaymentStatus enum value; there is no REFUND_QUEUED).
async function mockOrphanCancelledBooking(page: Page) {
  const now = Date.now();
  const start = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: MOCK_BOOKING_ID,
        ref: 'JDWL-ORPHANB2',
        status: 'CANCELLED',
        cancelledBy: 'SYSTEM',
        startDatetime: start,
        endDatetime: end,
        guests: 2,
        totalPrice: '300.00',
        serviceFee: '0',
        currencyCode: 'QAR',
        activity: {
          titleEn: 'Orphan Mock Activity',
          titleAr: 'نشاط تجريبي',
          slug: 'orphan-mock',
          gallery: [],
          coverImage: null,
          bookingType: 'HOURLY',
          cancellationPolicy: null,
          vendor: { businessNameEn: 'Mock Vendor', slug: 'mock-vendor' },
          country: { currencyCode: 'QAR', defaultTimezone: 'Asia/Qatar' },
        },
        payment: {
          id: 'pay-mock-b2',
          amount: '300.00',
          status: 'REFUND_PENDING',
          method: 'CARD',
          paidAt: new Date(now).toISOString(),
          createdAt: new Date(now).toISOString(),
          refundAmount: '300.00',
          refundedAt: null,
        },
      }),
    });
  });
}

test.describe('Customer payment callback — §B2 orphaned-paid refund', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('booking detail shows a refund-reassurance message for a SYSTEM auto-cancel', async ({ page }) => {
    await mockOrphanCancelledBooking(page);
    await page.goto(`/bookings/${MOCK_BOOKING_ID}`);
    await page.waitForLoadState('networkidle');

    // Reassurance: we couldn't confirm the booking + the payment is safe and a
    // refund has been queued (added as Wanasa points). Match the user-facing
    // intent across EN + AR rather than exact copy.
    await expect(
      page
        .getByText(/couldn'?t confirm|refund has been queued|payment of .* is safe|Wanasa points|تعذّر تأكيد|تمت جدولة استرداد/i)
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // It must NOT frame this as a customer-initiated "refund request under review".
    await expect(
      page.getByText(/will review your refund request|سيراجع طلب الاسترداد/i),
    ).toHaveCount(0);
  });
});
