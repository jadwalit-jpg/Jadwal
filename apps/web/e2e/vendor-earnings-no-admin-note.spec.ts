/**
 * E2E — vendor earnings page after §F5 / §B6.
 *
 * §B6 (Wave 1): vendor.getPayoutRequests now omits `adminNote` and
 * `paymentIds` from its API response — those are admin-internal forensic
 * fields that vendors must not see.
 *
 * §F5 (post-Wave 5 audit): the vendor earnings page used to render an
 * "Admin Note" column. Since the API never returns the field, the column
 * always rendered a dash placeholder — confusing UX implying there's
 * something there to read. The column is now dropped.
 *
 * This spec pins both contracts: the API response shape (no adminNote /
 * paymentIds) AND the rendered table (no Admin Note header).
 */
import { test, expect, type Route } from '@playwright/test';
import { isVendorAuthenticated, vendorSlugFromMe } from './_fixtures/auth';

const VENDOR_STATE = 'e2e/.auth/vendor.json';

const MOCK_PAYOUT_REQUESTS = {
  data: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      vendorId: 'vendor-mock',
      amount: '500.00',
      currency: 'QAR',
      status: 'REJECTED',
      processedAt: new Date(Date.now() - 86400_000).toISOString(),
      createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
      // Critically: no `adminNote`, no `paymentIds` keys here. The
      // server's explicit `select:` clause drops them.
    },
  ],
  total: 1,
  page: 1,
  limit: 10,
  totalPages: 1,
};

// Numbers (not strings) to match the live API: the page calls
// `eligibility.available.toFixed(2)` and would crash otherwise.
const MOCK_ELIGIBILITY = {
  ok: true,
  available: 1000.00,
  currency: 'QAR',
  totalEarned: 1500.00,
  totalPaid: 500.00,
  pendingCount: 0,
};

test.describe('Vendor earnings — §F5 + §B6', () => {
  test.use({ storageState: VENDOR_STATE });

  test.beforeEach(async ({ page }) => {
    if (!(await isVendorAuthenticated(page))) {
      test.skip(true, 'Vendor seed credentials unavailable; vendor storage state empty');
    }
    // Playwright matches page.route handlers LIFO (last registered, first
    // tried). Register the broader pattern FIRST so the more-specific
    // eligibility route registered next is reached first for that URL.
    await page.route('**/api/vendor/payout-requests**', async (route: Route) => {
      // Match GET /vendor/payout-requests AND its paginated variants.
      // The eligibility URL ends with /eligibility — let the more-specific
      // route below (registered after this one) handle it first.
      if (route.request().url().includes('/eligibility')) {
        await route.fallback();
        return;
      }
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_PAYOUT_REQUESTS),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/vendor/payout-requests/eligibility', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ELIGIBILITY),
      });
    });
  });

  test('§F5 — payout-requests table renders without Admin Note column', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    await page.goto(`/vendor/${slug}/earnings`);
    await page.waitForLoadState('networkidle');

    // Section heading + a cell carrying the amount confirms the table
    // rendered. Loose text match because the cell wraps a number + currency
    // + sometimes a status badge in the same span; the strict ^500\.00 QAR$
    // form misses that.
    await expect(page.getByRole('heading', { name: /payout requests|طلبات/i }).first())
      .toBeVisible();
    await expect(page.getByText('500.00').first()).toBeVisible();

    // The "Admin Note" column header MUST NOT appear anywhere on the page.
    // Locale-tolerant: en label was "Admin Note", ar likely "ملاحظة".
    // This is the F5 contract — admin's internal note must never reach the
    // vendor-side UI now that the API select clause omits the field.
    const adminNoteHeader = page.getByRole('columnheader', { name: /admin note|ملاحظة/i });
    await expect(adminNoteHeader).toHaveCount(0);
  });

  test('§B6 — API does not leak adminNote or paymentIds in response body', async ({ page }) => {
    // Bypass the page-route mock and hit the real backend through the
    // authenticated vendor's browser context. The contract under test is
    // the server's `select:` clause, not the rendered UI.
    const res = await page.request.get('http://localhost:4000/api/vendor/payout-requests?page=1&limit=10');
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    for (const row of body.data ?? []) {
      expect(Object.keys(row)).not.toContain('adminNote');
      expect(Object.keys(row)).not.toContain('paymentIds');
    }
  });
});
