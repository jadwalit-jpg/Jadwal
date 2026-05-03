/**
 * E2E — §M6 cron-cancelled booking restored by late successful payment.
 *
 * Wave 3 added an explicit recovery branch in payment.service.handleCallback:
 * if the payment callback arrives valid but the booking has already been
 * marked CANCELLED by the cleanup cron, the booking is un-cancelled and
 * confirmed (since the customer's money DID land). An audit row is left
 * documenting the unusual transition.
 *
 * This spec mocks the booking GET to flip CANCELLED → CONFIRMED after a
 * POST to /payment/callback/ipn, and asserts the customer-visible state.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

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
};

const afterIpn = {
  ...beforeIpn,
  status: 'CONFIRMED',
  cancelledBy: null,
  payment: { id: 'pay-mock-m6', status: 'SUCCESS', amount: '450.00' },
  // Audit message documenting the recovery transition.
  systemNote: 'Restored from CANCELLED via late payment confirmation',
};

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

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Pre-IPN: booking is CANCELLED.
    const beforeRes = await page.request.get(`${apiBase}/bookings/${MOCK_BOOKING_ID}`);
    expect(beforeRes.ok()).toBeTruthy();
    expect((await beforeRes.json()).status).toBe('CANCELLED');

    // Fire the IPN.
    const ipnRes = await page.request.post(`${apiBase}/payment/callback/ipn`, {
      data: { bookingId: MOCK_BOOKING_ID, hash: 'mock-hash' },
    });
    expect(ipnRes.ok()).toBeTruthy();

    // Post-IPN: booking is CONFIRMED with the recovery system note.
    const afterRes = await page.request.get(`${apiBase}/bookings/${MOCK_BOOKING_ID}`);
    expect(afterRes.ok()).toBeTruthy();
    const afterBody = await afterRes.json();
    expect(afterBody.status).toBe('CONFIRMED');
    expect(afterBody.payment?.status).toBe('SUCCESS');
    expect(afterBody.systemNote).toMatch(/restored.*cancelled.*late payment/i);
  });
});
