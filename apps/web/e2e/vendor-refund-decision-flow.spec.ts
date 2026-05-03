/**
 * E2E — multi-actor refund flow: customer requests refund, vendor decides.
 *
 * 1. Customer POST /bookings/:id/refund → creates a PENDING refund row
 * 2. Vendor GETs /vendor/refund-requests → sees the new row
 * 3. Vendor POST /vendor/refund-requests/:id/approve → row APPROVED
 * 4. Customer GETs /bookings/:id → sees refund status APPROVED
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';
const VENDOR_STATE = 'e2e/.auth/vendor.json';

const MOCK_BOOKING_ID = '00000000-0000-4000-8000-00000000s501';
const MOCK_REFUND_ID = '00000000-0000-4000-8000-00000000s502';

type RefundStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
let refundStatus: RefundStatus = 'NONE';

function bookingShape() {
  return {
    id: MOCK_BOOKING_ID,
    ref: 'JDWL-S5-0001',
    status: 'CONFIRMED',
    totalPrice: '300.00',
    currencyCode: 'QAR',
    refundRequest: refundStatus === 'NONE' ? null : {
      id: MOCK_REFUND_ID,
      status: refundStatus,
      reason: 'Schedule conflict',
    },
  };
}

async function setupCustomerRoutes(page: Page) {
  await page.route('**/api/bookings/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(bookingShape()),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/bookings/*/refund', async (route: Route) => {
    if (route.request().method() === 'POST') {
      refundStatus = 'PENDING';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_REFUND_ID, status: 'PENDING' }),
      });
      return;
    }
    await route.fallback();
  });
}

async function setupVendorRoutes(page: Page) {
  await page.route('**/api/vendor/refund-requests**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      const rows = refundStatus !== 'NONE'
        ? [{
            id: MOCK_REFUND_ID,
            bookingId: MOCK_BOOKING_ID,
            bookingRef: 'JDWL-S5-0001',
            status: refundStatus,
            reason: 'Schedule conflict',
            requestedAmount: '300.00',
            createdAt: new Date().toISOString(),
          }]
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows, total: rows.length, page: 1, totalPages: rows.length ? 1 : 0 }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`**/api/vendor/refund-requests/${MOCK_REFUND_ID}/approve`, async (route: Route) => {
    if (route.request().method() === 'POST') {
      refundStatus = 'APPROVED';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_REFUND_ID, status: 'APPROVED' }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Refund flow — customer requests, vendor approves', () => {
  test.beforeEach(() => {
    refundStatus = 'NONE';
  });

  test('customer request → vendor approve → customer sees APPROVED', async ({ browser }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Step 1+4 — customer context.
    const customerCtx = await browser.newContext({ storageState: CUSTOMER_STATE });
    const customerPage = await customerCtx.newPage();
    await setupCustomerRoutes(customerPage);

    const reqRes = await customerPage.request.post(
      `${apiBase}/bookings/${MOCK_BOOKING_ID}/refund`,
      { data: { reason: 'Schedule conflict' } },
    );
    expect(reqRes.ok()).toBeTruthy();
    expect(refundStatus).toBe('PENDING');

    // Step 2+3 — vendor context.
    const vendorCtx = await browser.newContext({ storageState: VENDOR_STATE });
    const vendorPage = await vendorCtx.newPage();
    await setupVendorRoutes(vendorPage);

    const list = await vendorPage.request.get(`${apiBase}/vendor/refund-requests?page=1`);
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    const row = (listBody.data ?? []).find((r: { id: string }) => r.id === MOCK_REFUND_ID);
    expect(row).toBeTruthy();
    expect(row.status).toBe('PENDING');

    const approve = await vendorPage.request.post(
      `${apiBase}/vendor/refund-requests/${MOCK_REFUND_ID}/approve`,
      { data: {} },
    );
    expect(approve.ok()).toBeTruthy();
    expect(refundStatus).toBe('APPROVED');
    await vendorCtx.close();

    // Step 4 — customer sees the APPROVED status.
    const final = await customerPage.request.get(`${apiBase}/bookings/${MOCK_BOOKING_ID}`);
    expect(final.ok()).toBeTruthy();
    const finalBody = await final.json();
    expect(finalBody.refundRequest?.status).toBe('APPROVED');
    await customerCtx.close();
  });
});
