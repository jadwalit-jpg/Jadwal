/**
 * E2E — §B7 admin audit-write failure rolls back the business mutation.
 *
 * Wave 2 moved the audit-log INSERT inside the same Prisma transaction as
 * the mutating admin endpoint. If the audit insert blows up (DB transient
 * error), the upstream mutation is rolled back so the admin action never
 * lands without a paper trail.
 *
 * From the user's perspective: clicking "Approve" on a payout request
 * with a misbehaving audit DB returns an error toast and the request row
 * is still PENDING when the page is refreshed.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_REQUEST_ID = '00000000-0000-4000-8000-0000000010b7';

const PENDING_REQUEST = {
  id: MOCK_REQUEST_ID,
  vendorId: 'v-mock',
  amount: '500.00',
  currency: 'QAR',
  status: 'PENDING',
  adminNote: null,
  processedAt: null,
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  vendor: { businessNameEn: 'Audit Rollback Vendor', slug: 'audit-rollback' },
};

const MOCK_REQUESTS_RESPONSE = {
  data: [PENDING_REQUEST],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

interface ApproveError {
  statusCode: number;
  message: string;
  error: string;
}

interface RequestsList {
  data: Array<{ id: string; status: string }>;
}

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/payouts/requests**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REQUESTS_RESPONSE),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin payouts — §B7 audit-failure rollback', () => {
  test.use({ storageState: ADMIN_STATE });

  test('approve mutation that triggers audit failure leaves request PENDING', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/admin/payouts');

    let approveCalls = 0;
    await page.route('**/api/admin/payouts/requests/*/approve', async (route: Route) => {
      if (route.request().method() === 'POST') {
        approveCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            message: 'Audit log write failed; payout approval rolled back.',
            error: 'AUDIT_WRITE_FAILED',
          }),
        });
        return;
      }
      await route.fallback();
    });

    const res = await fetchFromPage<ApproveError>(
      page,
      `/api/admin/payouts/requests/${MOCK_REQUEST_ID}/approve`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(res.status).toBe(500);
    expect(res.body?.error).toBe('AUDIT_WRITE_FAILED');
    expect(approveCalls).toBe(1);

    const list = await fetchFromPage<RequestsList>(page, '/api/admin/payouts/requests?page=1');
    expect(list.ok).toBeTruthy();
    const row = (list.body?.data ?? []).find((r) => r.id === MOCK_REQUEST_ID);
    expect(row?.status).toBe('PENDING');
  });
});
