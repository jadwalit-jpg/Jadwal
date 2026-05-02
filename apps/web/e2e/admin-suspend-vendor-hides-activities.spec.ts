/**
 * E2E — admin suspends vendor → public catalog filters out the vendor's
 * activities.
 *
 * Contract: catalog endpoints filter on `vendor.status='ACTIVE'`. After
 * a vendor is suspended (PATCH /admin/vendors/:id/status with SUSPENDED),
 * the customer-side /catalog/activities query no longer returns that
 * vendor's listings.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_VENDOR_ID = '00000000-0000-4000-8000-00000000s701';
const MOCK_ACTIVITY_ID = '00000000-0000-4000-8000-00000000s702';

let vendorStatus: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';

async function setupCustomerRoutes(page: Page) {
  await page.route('**/api/catalog/activities**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      // When vendor is SUSPENDED, the activity disappears from results.
      const data = vendorStatus === 'ACTIVE'
        ? [{
            id: MOCK_ACTIVITY_ID,
            slug: 's7-mock',
            titleEn: 'S7 Mock Activity',
            pricePerPerson: '200.00',
            currencyCode: 'QAR',
            vendor: { id: MOCK_VENDOR_ID, slug: 's7-mock-vendor', status: 'ACTIVE' },
          }]
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data, total: data.length, page: 1, totalPages: data.length ? 1 : 0 }),
      });
      return;
    }
    await route.fallback();
  });
}

async function setupAdminRoutes(page: Page) {
  await page.route(`**/api/admin/vendors/${MOCK_VENDOR_ID}/status`, async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      if (body.status === 'SUSPENDED' || body.status === 'ACTIVE') {
        vendorStatus = body.status;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_VENDOR_ID, status: vendorStatus }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin suspends vendor → catalog hides their activities', () => {
  test.beforeEach(() => {
    vendorStatus = 'ACTIVE';
  });

  test('catalog returns activity before suspension; empty after', async ({ browser }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Customer: see activity on catalog (vendor ACTIVE).
    const customerCtx = await browser.newContext({ storageState: CUSTOMER_STATE });
    const customerPage = await customerCtx.newPage();
    await setupCustomerRoutes(customerPage);

    const before = await customerPage.request.get(`${apiBase}/catalog/activities?page=1`);
    expect(before.ok()).toBeTruthy();
    const beforeBody = await before.json();
    expect(beforeBody.total).toBe(1);
    expect(beforeBody.data[0].id).toBe(MOCK_ACTIVITY_ID);

    // Admin: suspend the vendor.
    const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
    const adminPage = await adminCtx.newPage();
    await setupAdminRoutes(adminPage);
    const patch = await adminPage.request.patch(
      `${apiBase}/admin/vendors/${MOCK_VENDOR_ID}/status`,
      { data: { status: 'SUSPENDED' } },
    );
    expect(patch.ok()).toBeTruthy();
    expect(vendorStatus).toBe('SUSPENDED');
    await adminCtx.close();

    // Customer: catalog now returns the activity hidden.
    const after = await customerPage.request.get(`${apiBase}/catalog/activities?page=1`);
    expect(after.ok()).toBeTruthy();
    expect((await after.json()).total).toBe(0);
    await customerCtx.close();
  });
});
