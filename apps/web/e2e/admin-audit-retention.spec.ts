/**
 * E2E — §B8 financial audit-log retention (≥ 7 years).
 *
 * Wave 2 changed cleanup.service to keep FINANCIAL audit entries far longer
 * than the 180-day default (Qatar PDPL §14, GDPR Art.30, finance-records
 * standard). seed-e2e-data seeds a REAL FINANCIAL row (PAYOUT_MARK_PAID) dated
 * 4 years ago; this spec asserts that row is still returned by the audit-logs
 * API when filtered to FINANCIAL — i.e. it survived the OPERATIONAL retention
 * window. (Uses the real seeded row rather than a route mock so it can't drift
 * from the current audit-log response contract.)
 */
import { test, expect } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const RETENTION_FLOOR_DAYS = 180;

interface AuditRow {
  id: string;
  actionCategory: string;
  action: string;
  createdAt: string;
}
interface AuditList {
  data: AuditRow[];
}

test.describe('Admin audit logs — §B8 financial retention', () => {
  test.use({ storageState: ADMIN_STATE });

  test('financial entries older than 180 days remain queryable', async ({ page }) => {
    // Page renders without crashing on real data.
    await page.goto('/admin/audit-logs');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /audit/i }).first()).toBeVisible({ timeout: 10000 });

    // API contract: the 4-year-old seeded FINANCIAL row (PAYOUT_MARK_PAID) is
    // still returned — it outlived the 180-day OPERATIONAL retention. The endpoint
    // has no category filter; use `search` (matches the action) to fetch it.
    const res = await fetchFromPage<AuditList>(
      page,
      '/api/admin/audit-logs?search=PAYOUT_MARK_PAID&page=1&limit=20',
    );
    expect(res.ok).toBeTruthy();

    const rows = res.body?.data ?? [];
    // A FINANCIAL PAYOUT_MARK_PAID row older than the 180-day floor proves
    // financial entries are NOT purged on the standard OPERATIONAL schedule.
    const floor = Date.now() - RETENTION_FLOOR_DAYS * 86400_000;
    const oldFinancial = rows.find(
      (r) =>
        r.action === 'PAYOUT_MARK_PAID' &&
        r.actionCategory === 'FINANCIAL' &&
        new Date(r.createdAt).getTime() < floor,
    );
    expect(oldFinancial, 'expected a FINANCIAL PAYOUT_MARK_PAID audit row older than 180 days (seeded)').toBeTruthy();
  });
});
