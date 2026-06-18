/**
 * E2E — date-specific special pricing (vendor + admin).
 *
 * Two layers:
 *  1. API round-trip through the real server (auth → route → DTO → ownership →
 *     DB → response): set → list → delete a future-dated override, and confirm
 *     validation rejects a past date / non-positive price.
 *  2. UI smoke: the "Special prices by date" section renders on the Pricing
 *     step of the vendor + admin activity editors.
 *
 * Skips gracefully when seed data / a running API is absent — E2E is not a
 * required CI gate; it depends on the seeded e2e-activity + the auth states.
 */
import { test, expect } from '@playwright/test';
import { vendorSlugFromMe } from './_fixtures/auth';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const VENDOR_STATE = 'e2e/.auth/vendor.json';
const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

/** A future YYYY-MM-DD within the 6-month special-price window. */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Activity = { id: string };
type SpecialPrice = { id: string; date: string; price: string | number };

async function firstActivityId(page: import('@playwright/test').Page, scope: 'vendor' | 'admin'): Promise<string | null> {
  const res = await page.request.get(`${apiBase}/${scope}/activities?page=1&limit=1`).catch(() => null);
  if (!res || !res.ok()) return null;
  const body = (await res.json().catch(() => null)) as { data?: Activity[] } | null;
  return body?.data?.[0]?.id ?? null;
}

test.describe('Special pricing — vendor (own activity)', () => {
  test.use({ storageState: VENDOR_STATE });

  test('API: set → list → delete a per-date override', async ({ page }) => {
    const activityId = await firstActivityId(page, 'vendor');
    test.skip(!activityId, 'Vendor has no activities to price');
    const base = `${apiBase}/vendor/activities/${activityId}/special-prices`;
    const date = futureDate(30);

    const created = await page.request.post(base, { data: { date, price: 199.5 } });
    expect(created.ok()).toBeTruthy();

    const after = await page.request.get(base);
    expect(after.ok()).toBeTruthy();
    const rows = (await after.json()) as SpecialPrice[];
    const row = rows.find((r) => String(r.date).slice(0, 10) === date);
    expect(row, 'override should be listed').toBeTruthy();
    expect(Number(row!.price)).toBe(199.5);

    const del = await page.request.delete(`${base}/${row!.id}`);
    expect(del.ok()).toBeTruthy();
    const final = (await (await page.request.get(base)).json()) as SpecialPrice[];
    expect(final.find((r) => String(r.date).slice(0, 10) === date)).toBeFalsy();
  });

  test('API: rejects a past date and a non-positive price', async ({ page }) => {
    const activityId = await firstActivityId(page, 'vendor');
    test.skip(!activityId, 'Vendor has no activities');
    const base = `${apiBase}/vendor/activities/${activityId}/special-prices`;

    const past = await page.request.post(base, { data: { date: '2020-01-01', price: 100 } });
    expect(past.status()).toBe(400);
    const zero = await page.request.post(base, { data: { date: futureDate(20), price: 0 } });
    expect(zero.status()).toBe(400);
  });

  test('UI: special-prices section renders on the Pricing step', async ({ page }) => {
    const slug = await vendorSlugFromMe(page);
    const activitySlug = process.env.E2E_ACTIVITY_SLUG || 'e2e-activity';
    await page.goto(`/vendor/${slug}/activities/${activitySlug}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /pricing|التسعير/i }).first().click().catch(() => {});
    await expect(page.getByRole('heading', { name: /special prices by date|أسعار خاصة/i }))
      .toBeVisible({ timeout: 10000 });
  });
});

test.describe('Special pricing — admin (any activity)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('API: set → list → delete a per-date override on any activity', async ({ page }) => {
    const activityId = await firstActivityId(page, 'admin');
    test.skip(!activityId, 'No activities to price');
    const base = `${apiBase}/admin/activities/${activityId}/special-prices`;
    const date = futureDate(45);

    const created = await page.request.post(base, { data: { date, price: 275 } });
    expect(created.ok()).toBeTruthy();

    const rows = (await (await page.request.get(base)).json()) as SpecialPrice[];
    const row = rows.find((r) => String(r.date).slice(0, 10) === date);
    expect(row, 'override should be listed').toBeTruthy();
    expect(Number(row!.price)).toBe(275);

    const del = await page.request.delete(`${base}/${row!.id}`);
    expect(del.ok()).toBeTruthy();
  });

  test('UI: special-prices section renders on the admin Pricing step', async ({ page }) => {
    const activityId = await firstActivityId(page, 'admin');
    test.skip(!activityId, 'No activities');
    await page.goto(`/admin/activities/${activityId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /pricing|التسعير/i }).first().click().catch(() => {});
    await expect(page.getByRole('heading', { name: /special prices by date|أسعار خاصة/i }))
      .toBeVisible({ timeout: 10000 });
  });
});
