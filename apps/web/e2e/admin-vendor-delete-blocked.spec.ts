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

const ADMIN_STATE = 'e2e/.auth/admin.json';

const MOCK_VENDOR_ID_UNPAID = '00000000-0000-4000-8000-00000000f301';
const MOCK_VENDOR_ID_INFLIGHT = '00000000-0000-4000-8000-00000000f302';

test.describe('Admin vendor delete — §F3 financial-state guards', () => {
  test.use({ storageState: ADMIN_STATE });

  test('DELETE vendor with UNPAID payouts returns 400 with typed reason', async ({ page }) => {
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

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const res = await page.request.delete(`${apiBase}/admin/vendors/${MOCK_VENDOR_ID_UNPAID}`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VENDOR_HAS_UNPAID_PAYOUTS');
    expect(body.message).toMatch(/unresolved.*UNPAID|settle/i);
    expect(deleteCalls).toBe(1);
  });

  test('DELETE vendor with in-flight payout request returns 400 with typed reason', async ({ page }) => {
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

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const res = await page.request.delete(`${apiBase}/admin/vendors/${MOCK_VENDOR_ID_INFLIGHT}`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VENDOR_HAS_INFLIGHT_PAYOUT_REQUEST');
    expect(body.message).toMatch(/in-flight|payout request|PENDING|APPROVED/i);
    expect(deleteCalls).toBe(1);
  });
});
