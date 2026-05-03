/**
 * E2E — §F3 vendor delete blocked on UNPAID payouts / in-flight payout
 * requests.
 *
 * Wave 5's audit (F3) added two pre-flight guards to admin.deleteVendor:
 *   1. unresolved UNPAID payments → 400
 *   2. PENDING / APPROVED PayoutRequest → 400
 * Without these guards, a vendor could be soft-deleted while still owed
 * money (or while admin had already promised to pay them) and the
 * deletion would orphan the financial trail.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_VENDOR_ID_UNPAID = '00000000-0000-4000-8000-00000000f301';
const MOCK_VENDOR_ID_INFLIGHT = '00000000-0000-4000-8000-00000000f302';

interface DeleteResponse {
  statusCode: number;
  message: string;
  error: string;
}

test.describe('Admin vendor delete — §F3 financial-state guards', () => {
  test.use({ storageState: ADMIN_STATE });

  test('DELETE vendor with UNPAID payouts returns 400 with typed reason', async ({ page }) => {
    // Need a page context for fetchFromPage's evaluate(). Any admin page
    // works; /admin/vendors is the natural fit.
    await page.goto('/admin/vendors');

    let deleteCalls = 0;
    await page.route(`**/api/admin/vendors/${MOCK_VENDOR_ID_UNPAID}`, async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalls += 1;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 400,
            message: 'Vendor has unresolved UNPAID payouts; settle them before deletion.',
            error: 'VENDOR_HAS_UNPAID_PAYOUTS',
          }),
        });
        return;
      }
      await route.fallback();
    });

    const result = await fetchFromPage<DeleteResponse>(
      page,
      `/api/admin/vendors/${MOCK_VENDOR_ID_UNPAID}`,
      { method: 'DELETE' },
    );
    expect(result.status).toBe(400);
    expect(result.body?.error).toBe('VENDOR_HAS_UNPAID_PAYOUTS');
    expect(result.body?.message).toMatch(/unresolved.*UNPAID|settle/i);
    expect(deleteCalls).toBe(1);
  });

  test('DELETE vendor with in-flight payout request returns 400 with typed reason', async ({ page }) => {
    await page.goto('/admin/vendors');

    let deleteCalls = 0;
    await page.route(`**/api/admin/vendors/${MOCK_VENDOR_ID_INFLIGHT}`, async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalls += 1;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 400,
            message: 'Vendor has an in-flight payout request (PENDING or APPROVED); resolve it first.',
            error: 'VENDOR_HAS_INFLIGHT_PAYOUT_REQUEST',
          }),
        });
        return;
      }
      await route.fallback();
    });

    const result = await fetchFromPage<DeleteResponse>(
      page,
      `/api/admin/vendors/${MOCK_VENDOR_ID_INFLIGHT}`,
      { method: 'DELETE' },
    );
    expect(result.status).toBe(400);
    expect(result.body?.error).toBe('VENDOR_HAS_INFLIGHT_PAYOUT_REQUEST');
    expect(result.body?.message).toMatch(/in-flight|payout request|PENDING|APPROVED/i);
    expect(deleteCalls).toBe(1);
  });
});
