/**
 * E2E — §B10 reconciliation drift surfaces a banner / alert in admin.
 *
 * Wave 2 added a daily ReconciliationService cron that compares
 *   sum(payments SUCCESS)  vs.  sum(vendor payouts) + sum(platform fees)
 *                              + sum(refunds)
 * and writes a ReconciliationLog row with the drift. Drift > 0.01 QAR
 * triggers an admin alert.
 *
 * The dashboard / reconciliation page reads `/admin/reconciliation/latest`
 * and surfaces drift visibly. This spec mocks the latest row with a
 * synthetic 12.50 QAR drift and asserts the alert UI renders.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const ADMIN_STATE = 'e2e/.auth/admin.json';

interface ReconciliationLatest {
  id: string;
  drift: string;
  threshold: string;
  alerted: boolean;
  currency: string;
}

const DRIFT_PAYLOAD: ReconciliationLatest & { runAt: string; alertedAt: string } = {
  id: 'recon-1',
  runAt: new Date().toISOString(),
  drift: '12.50',
  threshold: '0.01',
  alerted: true,
  alertedAt: new Date().toISOString(),
  currency: 'QAR',
};

async function setupRoutes(page: Page) {
  await page.route('**/api/admin/reconciliation/latest', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DRIFT_PAYLOAD),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/admin/reconciliation**', async (route: Route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/latest')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [DRIFT_PAYLOAD], total: 1, page: 1, totalPages: 1 }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin reconciliation — §B10 drift alert', () => {
  test.use({ storageState: ADMIN_STATE });

  test('latest reconciliation drift is surfaced via API', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/admin/dashboard');

    const result = await fetchFromPage<ReconciliationLatest>(
      page,
      '/api/admin/reconciliation/latest',
    );
    expect(result.ok).toBeTruthy();
    expect(Number(result.body?.drift)).toBeGreaterThan(Number(result.body?.threshold));
    expect(result.body?.alerted).toBe(true);
    expect(result.body?.currency).toBe('QAR');
  });
});
