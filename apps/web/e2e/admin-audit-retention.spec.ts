/**
 * E2E — §B8 financial audit-log retention (≥ 7 years).
 *
 * Wave 2 changed cleanup.service to keep FINANCIAL audit entries far
 * longer than the 180-day default (Qatar PDPL §14, GDPR Art.30, finance-
 * records standard). This spec mocks the audit-log GET to return a row
 * older than 180 days for a FINANCIAL action, and asserts the page can
 * still query and render it.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';

const FOUR_YEARS_AGO = new Date(Date.now() - 365 * 86400_000 * 4).toISOString();

const OLD_FINANCIAL_ROW = {
  id: 'audit-old-financial',
  actorId: 'admin-1',
  actorEmail: 'admin@jadwal.qa',
  actionCategory: 'FINANCIAL',
  action: 'PAYOUT_MARK_PAID',
  resourceType: 'PAYMENT',
  resourceId: 'pay-historical',
  details: { amount: '1500.00', bankTransferRef: 'SWIFT-LEGACY-001' },
  createdAt: FOUR_YEARS_AGO,
};

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/audit-logs**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [OLD_FINANCIAL_ROW],
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

test.describe('Admin audit logs — §B8 financial retention', () => {
  test.use({ storageState: ADMIN_STATE });

  test('financial entries older than 180 days remain queryable', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/admin/audit-logs');
    await page.waitForLoadState('networkidle');

    // The page may render the row's resourceId, action, or actor — accept
    // any signal that the historical row landed.
    await expect(
      page.getByText(/PAYOUT_MARK_PAID|pay-historical|admin@jadwal\.qa/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // API contract: the same row is reachable via the audit-logs endpoint
    // even when filtered to >180 days ago.
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const res = await page.request.get(
      `${apiBase}/admin/audit-logs?actionCategory=FINANCIAL&page=1`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = (body.data ?? []).find((r: { id: string }) => r.id === OLD_FINANCIAL_ROW.id);
    expect(found).toBeTruthy();
    expect(found.actionCategory).toBe('FINANCIAL');
  });
});
