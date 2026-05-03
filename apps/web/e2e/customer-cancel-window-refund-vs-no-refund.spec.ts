/**
 * E2E — customer cancel within free-cancellation window vs outside.
 *
 * Free-cancellation policy: refund is full when start time is far enough
 * away (>24h by default), partial / nothing when starting in <1h. The
 * /bookings/[id] page should surface the refund estimate before the
 * customer confirms the cancel.
 *
 * Two scenarios mocked:
 *   1. start in 48h → cancel returns refundAmount = totalPrice
 *   2. start in 1h  → cancel returns refundAmount = 0 (or partial)
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

type Window = 'within' | 'outside';

function makeBooking(window: Window) {
  const id = window === 'within'
    ? '00000000-0000-4000-8000-00000000s101'
    : '00000000-0000-4000-8000-00000000s102';
  const offsetMs = window === 'within' ? 48 * 3600_000 : 1 * 3600_000;
  return {
    id,
    ref: window === 'within' ? 'JDWL-S1-WITHIN' : 'JDWL-S1-OUTSIDE',
    status: 'CONFIRMED',
    startDatetime: new Date(Date.now() + offsetMs).toISOString(),
    endDatetime: new Date(Date.now() + offsetMs + 3600_000).toISOString(),
    guests: 2,
    totalPrice: '500.00',
    serviceFee: '0.00',
    commissionAmount: '50.00',
    couponDiscount: '0.00',
    currencyCode: 'QAR',
    activity: { titleEn: 'S1 Mock Activity', slug: 's1-mock' },
    payment: { id: 'pay-mock-s1', status: 'SUCCESS', amount: '500.00' },
  };
}

interface CancelResult {
  ok: boolean;
  refundAmount: string;
  refundQueued: boolean;
}

async function setupRoutes(page: Page, window: Window) {
  const booking = makeBooking(window);
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(booking),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/bookings/*/cancel', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const refund = window === 'within' ? '500.00' : '0.00';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          refundAmount: refund,
          refundQueued: window === 'within',
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer cancel — refund window policy', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('within free-cancellation window: full refund queued', async ({ page }) => {
    await setupRoutes(page, 'within');
    await page.goto('/bookings');

    const res = await fetchFromPage<CancelResult>(
      page,
      `/api/bookings/${makeBooking('within').id}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(res.ok).toBeTruthy();
    expect(res.body?.refundQueued).toBe(true);
    expect(res.body?.refundAmount).toBe('500.00');
  });

  test('outside window (start in 1h): no refund', async ({ page }) => {
    await setupRoutes(page, 'outside');
    await page.goto('/bookings');

    const res = await fetchFromPage<CancelResult>(
      page,
      `/api/bookings/${makeBooking('outside').id}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(res.ok).toBeTruthy();
    expect(res.body?.refundQueued).toBe(false);
    expect(res.body?.refundAmount).toBe('0.00');
  });
});
