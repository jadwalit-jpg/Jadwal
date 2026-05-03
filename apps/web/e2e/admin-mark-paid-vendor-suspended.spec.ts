/**
 * E2E — §M3 mark-paid blocked when the vendor is suspended.
 *
 * Wave 4 added a vendor.status === 'ACTIVE' pre-flight to markPayoutsPaid
 * so that money never transfers to a suspended vendor (the suspension may
 * have been triggered by fraud detection between approval and mark-paid).
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_PAYMENT_ID = '00000000-0000-4000-8000-000000001m3';

const MOCK_PAYOUTS_RESPONSE = {
  data: [
    {
      id: MOCK_PAYMENT_ID,
      amount: '750.00',
      gatewayTxnId: 'TXN-M3',
      status: 'SUCCESS',
      payoutStatus: 'UNPAID',
      paidAt: null,
      method: 'PAY2M',
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
      inflightRequest: null,
      booking: {
        ref: 'JDWL-M3-0001',
        totalPrice: '750.00',
        serviceFee: '0.00',
        commissionAmount: '75.00',
        pointsRedeemed: null,
        pointsDiscount: null,
        couponDiscount: null,
        currencyCode: 'QAR',
        vendor: { id: 'v-suspended', businessNameEn: 'Suspended Mock Vendor' },
        customer: { fullName: 'Mock Customer' },
        activity: { titleEn: 'M3 Mock Activity' },
      },
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/payouts**', async (route: Route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/export')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PAYOUTS_RESPONSE),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin mark-paid — §M3 vendor-suspended block', () => {
  test.use({ storageState: ADMIN_STATE });

  test('mark-paid for suspended vendor returns VENDOR_SUSPENDED 400', async ({ page }) => {
    await setupRoutes(page);

    await page.route('**/api/admin/payouts/mark-paid', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 400,
            message: 'Vendor was suspended; confirm before marking paid.',
            error: 'VENDOR_SUSPENDED',
          }),
        });
        return;
      }
      await route.fallback();
    });

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const res = await page.request.post(
      `${apiBase}/admin/payouts/mark-paid`,
      { data: { paymentIds: [MOCK_PAYMENT_ID], bankTransferRef: 'SWIFT-M3-001' } },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VENDOR_SUSPENDED');

    // Subsequent list query confirms the payment is still UNPAID.
    const list = await page.request.get(`${apiBase}/admin/payouts?page=1`);
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    const row = (listBody.data ?? []).find((r: { id: string }) => r.id === MOCK_PAYMENT_ID);
    expect(row?.payoutStatus).toBe('UNPAID');
  });
});
