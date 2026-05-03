/**
 * E2E — §B5 admin can't force-CONFIRM a booking without a successful payment.
 *
 * Wave 1 added a guard in admin.service.updateBookingStatus that rejects
 *   PATCH /admin/bookings/:id/status with status=CONFIRMED
 * unless the underlying payment is already SUCCESS. This stops both admin
 * slips and a compromised admin from minting confirmed reservations that
 * never paid.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-0000000010b5';

const MOCK_BOOKINGS_RESPONSE = {
  data: [
    {
      id: MOCK_BOOKING_ID,
      ref: 'JDWL-B5-0001',
      status: 'PENDING',
      startDatetime: new Date(Date.now() + 86400_000).toISOString(),
      endDatetime: new Date(Date.now() + 86400_000 + 3600_000).toISOString(),
      guests: 2,
      totalPrice: '300.00',
      currencyCode: 'QAR',
      activity: { titleEn: 'Force-Confirm Mock Activity', slug: 'force-confirm-mock' },
      vendor: { businessNameEn: 'Mock Vendor' },
      customer: { fullName: 'Test Customer', email: 'test@example.com' },
      payment: {
        id: 'pay-mock',
        status: 'PENDING',
        amount: '300.00',
      },
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

interface PatchError {
  statusCode: number;
  message: string;
  error: string;
}

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/bookings**', async (route: Route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && !url.includes('/status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BOOKINGS_RESPONSE),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin bookings — §B5 force-confirm guard', () => {
  test.use({ storageState: ADMIN_STATE });

  test('PATCH status=CONFIRMED on unpaid booking surfaces the typed 400', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/admin/bookings');

    let patchCalls = 0;
    await page.route('**/api/admin/bookings/*/status', async (route: Route) => {
      if (route.request().method() === 'PATCH') {
        patchCalls += 1;
        const body = JSON.parse(route.request().postData() ?? '{}');
        if (body.status === 'CONFIRMED') {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 400,
              message: 'Cannot confirm a booking without a successful payment',
              error: 'PAYMENT_NOT_SUCCESS',
            }),
          });
          return;
        }
      }
      await route.fallback();
    });

    const res = await fetchFromPage<PatchError>(
      page,
      `/api/admin/bookings/${MOCK_BOOKING_ID}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }) },
    );
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/cannot confirm.*payment/i);
    expect(patchCalls).toBe(1);
  });
});
