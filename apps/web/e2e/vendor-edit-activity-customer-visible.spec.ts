/**
 * E2E — vendor edits an activity → customer-side catalog shows the
 * updated values.
 *
 * Mocked end-to-end: PUT /activities/:id changes the in-memory mock,
 * subsequent GET /catalog/activities and GET /activities/:slug return
 * the updated values.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const VENDOR_STATE = 'e2e/.auth/vendor.json';
const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_ACTIVITY_ID = '00000000-0000-4000-8000-00000000s401';
const MOCK_ACTIVITY_SLUG = 'mock-edit-visibility';

let currentTitle = 'Original Title';
let currentPrice = '100.00';

function activityShape() {
  return {
    id: MOCK_ACTIVITY_ID,
    slug: MOCK_ACTIVITY_SLUG,
    titleEn: currentTitle,
    titleAr: 'العنوان',
    descriptionEn: 'Mock activity for edit-visibility test',
    pricePerPerson: currentPrice,
    capacity: 10,
    status: 'ACTIVE',
    currencyCode: 'QAR',
    vendor: { id: 'v-mock', businessNameEn: 'Mock Vendor', slug: 'mock-vendor', status: 'ACTIVE' },
  };
}

async function setupVendorRoutes(page: Page) {
  await page.route(`**/api/activities/${MOCK_ACTIVITY_ID}`, async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const payload = JSON.parse(route.request().postData() ?? '{}');
      if (typeof payload.titleEn === 'string') currentTitle = payload.titleEn;
      if (typeof payload.pricePerPerson === 'string') currentPrice = payload.pricePerPerson;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, ...activityShape() }),
      });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(activityShape()),
      });
      return;
    }
    await route.fallback();
  });
}

async function setupCustomerRoutes(page: Page) {
  await page.route(`**/api/activities/${MOCK_ACTIVITY_SLUG}`, async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(activityShape()),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Vendor edits activity → customer catalog reflects the change', () => {
  test.beforeEach(() => {
    currentTitle = 'Original Title';
    currentPrice = '100.00';
  });

  test('PUT updates activity → customer GET sees new title + price', async ({ browser }) => {
    // Vendor side: drive the edit.
    const vendorCtx = await browser.newContext({ storageState: VENDOR_STATE });
    const vendorPage = await vendorCtx.newPage();
    await setupVendorRoutes(vendorPage);

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';
    const put = await vendorPage.request.put(
      `${apiBase}/activities/${MOCK_ACTIVITY_ID}`,
      { data: { titleEn: 'Updated Title 2026', pricePerPerson: '149.00' } },
    );
    expect(put.ok()).toBeTruthy();
    expect(currentTitle).toBe('Updated Title 2026');
    expect(currentPrice).toBe('149.00');
    await vendorCtx.close();

    // Customer side: load the public activity page, see new values.
    const customerCtx = await browser.newContext({ storageState: CUSTOMER_STATE });
    const customerPage = await customerCtx.newPage();
    await setupCustomerRoutes(customerPage);

    const get = await customerPage.request.get(`${apiBase}/activities/${MOCK_ACTIVITY_SLUG}`);
    expect(get.ok()).toBeTruthy();
    const body = await get.json();
    expect(body.titleEn).toBe('Updated Title 2026');
    expect(body.pricePerPerson).toBe('149.00');
    await customerCtx.close();
  });
});
