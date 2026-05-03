/**
 * E2E — §B3 customer cancels a COMPLETED booking → earned points reversed.
 *
 * Wave 1 closed the "earn-then-cancel" double-dip: when a customer
 * cancels (or refunds) a booking that already had `pointsAwarded = true`,
 * the server now debits the awarded points via
 * loyalty.refund({ source: 'CANCEL_REVERSE_AWARDED' }).
 *
 * This spec mocks the loyalty balance + ledger sequence: 500 before the
 * cancel, 400 after, and a CANCEL_REVERSE_AWARDED -100 ledger row.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010b3';

const COMPLETED_BOOKING = {
  id: MOCK_BOOKING_ID,
  ref: 'JDWL-B3-0001',
  status: 'COMPLETED',
  pointsAwarded: true,
  startDatetime: new Date(Date.now() - 86400_000 * 2).toISOString(),
  endDatetime: new Date(Date.now() - 86400_000 * 2 + 3600_000).toISOString(),
  guests: 1,
  totalPrice: '100.00',
  currencyCode: 'QAR',
  activity: { titleEn: 'B3 Mock Activity', slug: 'b3-mock' },
  payment: { id: 'pay-mock-b3', status: 'SUCCESS', amount: '100.00' },
};

const CANCELLED_BOOKING = { ...COMPLETED_BOOKING, status: 'CANCELLED' };

let cancelHasRun = false;

interface CancelResult {
  ok: boolean;
  pointsReversed: number;
}

interface BalanceResult {
  balance: number;
  totalReversed: number;
}

interface LedgerRow {
  source: string;
  delta: number;
}

interface LedgerList {
  data: LedgerRow[];
}

async function setupRoutes(page: Page) {
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cancelHasRun ? CANCELLED_BOOKING : COMPLETED_BOOKING),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/loyalty/balance**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balance: cancelHasRun ? 400 : 500,
          totalEarned: 500,
          totalRedeemed: 0,
          totalReversed: cancelHasRun ? 100 : 0,
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/loyalty/ledger**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      const rows: LedgerRow[] = [
        { source: 'BOOKING_EARN', delta: 100 },
      ];
      if (cancelHasRun) {
        rows.unshift({ source: 'CANCEL_REVERSE_AWARDED', delta: -100 });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows, total: rows.length, page: 1, totalPages: 1 }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer cancel — §B3 points reversal', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeEach(() => {
    cancelHasRun = false;
  });

  test('cancelling a COMPLETED booking debits previously-awarded points', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/bookings');

    await page.route('**/api/bookings/*/cancel', async (route: Route) => {
      if (route.request().method() === 'POST') {
        cancelHasRun = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, pointsReversed: 100 }),
        });
        return;
      }
      await route.fallback();
    });

    const cancel = await fetchFromPage<CancelResult>(
      page,
      `/api/bookings/${MOCK_BOOKING_ID}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(cancel.ok).toBeTruthy();
    expect(cancel.body?.pointsReversed).toBe(100);

    const balance = await fetchFromPage<BalanceResult>(page, '/api/loyalty/balance');
    expect(balance.ok).toBeTruthy();
    expect(balance.body?.balance).toBe(400);
    expect(balance.body?.totalReversed).toBe(100);

    const ledger = await fetchFromPage<LedgerList>(page, '/api/loyalty/ledger?page=1');
    expect(ledger.ok).toBeTruthy();
    const reverse = (ledger.body?.data ?? []).find(
      (r) => r.source === 'CANCEL_REVERSE_AWARDED',
    );
    expect(reverse).toBeTruthy();
    expect(reverse?.delta).toBe(-100);
  });
});
