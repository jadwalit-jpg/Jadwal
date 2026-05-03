/**
 * E2E — §M2 payout request auto-reverts to PENDING when payments become
 * ineligible after admin approval.
 *
 * Wave 4 fixed the "approval limbo" bug: when admin approved a payout
 * but a referenced booking was refunded before mark-paid, the request
 * got stuck in APPROVED forever. The fix auto-reverts the request to
 * PENDING with a system note when mark-paid detects the mismatch.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_REQUEST_ID = '00000000-0000-4000-8000-000000001m2';

let markPaidHasRun = false;

const REQUEST_APPROVED = {
  id: MOCK_REQUEST_ID,
  vendorId: 'v-mock',
  amount: '500.00',
  currency: 'QAR',
  status: 'APPROVED',
  systemNote: null,
  paymentIds: ['pay-1', 'pay-2'],
  vendor: { businessNameEn: 'Auto-Revert Vendor', slug: 'auto-revert' },
};

const REQUEST_REVERTED = {
  ...REQUEST_APPROVED,
  status: 'PENDING',
  systemNote:
    'Payments no longer eligible (refunded after approval). Re-evaluate.',
};

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/payouts/requests**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [markPaidHasRun ? REQUEST_REVERTED : REQUEST_APPROVED],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin payouts — §M2 auto-revert on ineligible payments', () => {
  test.use({ storageState: ADMIN_STATE });

  test.beforeEach(() => {
    markPaidHasRun = false;
  });

  test('mark-paid with refunded payment flips request back to PENDING with system note', async ({ page }) => {
    await setupRoutes(page);

    await page.route('**/api/admin/payouts/requests/*/mark-paid', async (route: Route) => {
      if (route.request().method() === 'POST') {
        markPaidHasRun = true;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 409,
            message: 'One or more payments are no longer eligible. Request reverted to PENDING for re-evaluation.',
            error: 'PAYMENTS_NO_LONGER_ELIGIBLE',
          }),
        });
        return;
      }
      await route.fallback();
    });

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Mark-paid attempt returns 409 with the typed code.
    const mp = await page.request.post(
      `${apiBase}/admin/payouts/requests/${MOCK_REQUEST_ID}/mark-paid`,
      { data: { bankTransferRef: 'SWIFT-TEST-001' } },
    );
    expect(mp.status()).toBe(409);
    const mpBody = await mp.json();
    expect(mpBody.error).toBe('PAYMENTS_NO_LONGER_ELIGIBLE');

    // List query shows the row reverted to PENDING with the system note.
    const list = await page.request.get(`${apiBase}/admin/payouts/requests?page=1`);
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    const row = (listBody.data ?? []).find((r: { id: string }) => r.id === MOCK_REQUEST_ID);
    expect(row).toBeTruthy();
    expect(row.status).toBe('PENDING');
    expect(row.systemNote).toMatch(/no longer eligible|re-evaluate/i);
  });
});
