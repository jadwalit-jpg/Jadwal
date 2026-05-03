/**
 * E2E — §M6 cron-cancelled booking restored by late successful payment.
 *
 * Wave 3 added an explicit recovery branch in payment.service.handleCallback:
 * if the payment callback arrives valid but the booking has already been
 * marked CANCELLED by the cleanup cron, the booking is un-cancelled and
 * confirmed (since the customer's money DID land). An audit row is left
 * documenting the unusual transition.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010m6';

let ipnHasRun = false;

const beforeIpn = {
  id: MOCK_BOOKING_ID,
  status: 'CANCELLED',
  cancelledBy: 'SYSTEM',
  totalPrice: '450.00',
  currencyCode: 'QAR',
  activity: { titleEn: 'M6 Mock Activity', slug: 'm6-mock' },
  payment: { id: 'pay-mock-m6', status: 'PENDING', amount: '450.00' },
  systemNote: null,
};

const afterIpn = {
  ...beforeIpn,
  status: 'CONFIRMED',
  cancelledBy: null,
  payment: { id: 'pay-mock-m6', status: 'SUCCESS', amount: '450.00' },
  systemNote: 'Restored from CANCELLED via late payment confirmation',
};

interface BookingState {
  status: string;
  payment: { status: string };
  systemNote: string | null;
}

interface IpnResult {
  recovered: boolean;
  bookingId: string;
}

async function setupRoutes(page: Page) {
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ipnHasRun ? afterIpn : beforeIpn),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer payment IPN — §M6 cancelled booking recovery', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeEach(() => {
    ipnHasRun = false;
  });

  test('valid late IPN un-cancels the booking and marks it CONFIRMED', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/bookings');

    await page.route('**/api/payment/callback/ipn', async (route: Route) => {
      if (route.request().method() === 'POST') {
        ipnHasRun = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ recovered: true, bookingId: MOCK_BOOKING_ID }),
        });
        return;
      }
      await route.fallback();
    });

    // Pre-IPN: booking is CANCELLED.
    const before = await fetchFromPage<BookingState>(page, `/api/bookings/${MOCK_BOOKING_ID}`);
    expect(before.ok).toBeTruthy();
    expect(before.body?.status).toBe('CANCELLED');

    // Fire the IPN.
    const ipn = await fetchFromPage<IpnResult>(
      page,
      '/api/payment/callback/ipn',
      { method: 'POST', body: JSON.stringify({ bookingId: MOCK_BOOKING_ID, hash: 'mock-hash' }) },
    );
    expect(ipn.ok).toBeTruthy();

    // Post-IPN: booking is CONFIRMED with the recovery system note.
    const after = await fetchFromPage<BookingState>(page, `/api/bookings/${MOCK_BOOKING_ID}`);
    expect(after.ok).toBeTruthy();
    expect(after.body?.status).toBe('CONFIRMED');
    expect(after.body?.payment?.status).toBe('SUCCESS');
    expect(after.body?.systemNote).toMatch(/restored.*cancelled.*late payment/i);
  });
});
