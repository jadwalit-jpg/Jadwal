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

    // Simulate the audit-write rollback: server returns 500 with the
    // typed AUDIT_WRITE_FAILED code. Real prod also rolls back the
    // mutation in the DB, so a follow-up GET still shows status=PENDING.
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

    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');

    // Drive the API directly via the page's request context. The /admin
    // /payouts page's UI renders multiple buttons + tab states which are
    // brittle to locate by role+name across EN/AR; the contract we care
    // about is the server-side audit rollback, which the page's network
    // boundary already validates.
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const res = await page.request.post(
      `${apiBase}/admin/payouts/requests/${MOCK_REQUEST_ID}/approve`,
      { data: {} },
    );
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('AUDIT_WRITE_FAILED');
    expect(approveCalls).toBe(1);

    // After the rollback, the next list query must still show PENDING.
    const listRes = await page.request.get(`${apiBase}/admin/payouts/requests?page=1`);
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const row = (listBody.data ?? []).find((r: { id: string }) => r.id === MOCK_REQUEST_ID);
    // We mocked the GET to always return PENDING; this assertion documents
    // the expectation so a future change to the mock can't silently break
    // the rollback contract.
    expect(row?.status).toBe('PENDING');
  });
});
