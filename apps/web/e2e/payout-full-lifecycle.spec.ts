/**
 * E2E — full payout lifecycle: vendor request → admin approve → admin
 * mark paid (with bankTransferRef) → vendor sees PAID.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_REQUEST_ID = '00000000-0000-4000-8000-00000000s601';
const MOCK_PAYMENT_ID = '00000000-0000-4000-8000-00000000s602';

type Status = 'NONE' | 'PENDING' | 'APPROVED' | 'PAID';
let requestStatus: Status = 'NONE';

function requestShape() {
  return {
    id: MOCK_REQUEST_ID,
    amount: '500.00',
    currency: 'QAR',
    status: requestStatus === 'NONE' ? 'PENDING' : requestStatus,
    paymentIds: [MOCK_PAYMENT_ID],
    bankTransferRef: requestStatus === 'PAID' ? 'SWIFT-S6-001' : null,
    processedAt: requestStatus === 'PAID' ? new Date().toISOString() : null,
  };
}

async function setupVendorRoutes(page: Page) {
  await page.route('**/api/vendor/payout-requests**', async (route: Route) => {
    if (route.request().method() === 'POST' && !route.request().url().includes('/eligibility')) {
      requestStatus = 'PENDING';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(requestShape()),
      });
      return;
    }
    if (route.request().method() === 'GET' && !route.request().url().includes('/eligibility')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [requestShape()], total: 1, page: 1, totalPages: 1 }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/vendor/payout-requests/eligibility**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          available: 500,
          pending: 0,
          totalEarnings: 500,
          currency: 'QAR',
        }),
      });
      return;
    }
    await route.fallback();
  });
}

async function setupAdminRoutes(page: Page) {
  await page.route('**/api/admin/payouts/requests**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [requestShape()], total: 1, page: 1, totalPages: 1 }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`**/api/admin/payouts/requests/${MOCK_REQUEST_ID}/approve`, async (route: Route) => {
    if (route.request().method() === 'POST') {
      requestStatus = 'APPROVED';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(requestShape()),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/admin/payouts/mark-paid', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      // §M4 — bankTransferRef is REQUIRED.
      if (!body.bankTransferRef || body.bankTransferRef.length < 3) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 400,
            message: 'bankTransferRef is required',
            error: 'BANK_TRANSFER_REF_REQUIRED',
          }),
        });
        return;
      }
      requestStatus = 'PAID';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: 1 }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Payout — full lifecycle (vendor → admin approve → mark paid)', () => {
  test.beforeEach(() => {
    requestStatus = 'NONE';
  });

  test('end-to-end: vendor request → admin approve → admin mark paid → vendor sees PAID', async ({ browser }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Vendor: submit request.
    const vendorCtx = await browser.newContext({ storageState: VENDOR_STATE });
    const vendorPage = await vendorCtx.newPage();
    await setupVendorRoutes(vendorPage);

    const submit = await vendorPage.request.post(`${apiBase}/vendor/payout-requests`, {
      data: { amount: '500.00' },
    });
    expect(submit.status()).toBe(201);
    expect(requestStatus).toBe('PENDING');

    // Admin: approve.
    const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
    const adminPage = await adminCtx.newPage();
    await setupAdminRoutes(adminPage);

    const approve = await adminPage.request.post(
      `${apiBase}/admin/payouts/requests/${MOCK_REQUEST_ID}/approve`,
      { data: {} },
    );
    expect(approve.ok()).toBeTruthy();
    expect(requestStatus).toBe('APPROVED');

    // Admin: mark-paid (without bankTransferRef must fail).
    const noRef = await adminPage.request.post(`${apiBase}/admin/payouts/mark-paid`, {
      data: { paymentIds: [MOCK_PAYMENT_ID] },
    });
    expect(noRef.status()).toBe(400);
    expect(requestStatus).toBe('APPROVED'); // unchanged

    // Admin: mark-paid with valid ref.
    const withRef = await adminPage.request.post(`${apiBase}/admin/payouts/mark-paid`, {
      data: { paymentIds: [MOCK_PAYMENT_ID], bankTransferRef: 'SWIFT-S6-001' },
    });
    expect(withRef.ok()).toBeTruthy();
    expect(requestStatus).toBe('PAID');
    await adminCtx.close();

    // Vendor: sees PAID.
    const list = await vendorPage.request.get(`${apiBase}/vendor/payout-requests?page=1`);
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    const row = (listBody.data ?? []).find((r: { id: string }) => r.id === MOCK_REQUEST_ID);
    expect(row?.status).toBe('PAID');
    expect(row?.bankTransferRef).toBe('SWIFT-S6-001');
    await vendorCtx.close();
  });
});
