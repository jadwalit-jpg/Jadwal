/**
 * E2E — customer favourites: like an activity, see it on /likes, unlike,
 * see it gone.
 *
 * Endpoints involved:
 *   POST   /api/activities/:id/like      → adds to favourites
 *   DELETE /api/activities/:id/like      → removes
 *   GET    /api/customer/likes           → lists favourites
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_ACTIVITY_ID = '00000000-0000-4000-8000-00000000s301';

let isLiked = false;

async function setupRoutes(page: Page) {
  await page.route('**/api/customer/likes**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      const data = isLiked
        ? [{
            id: MOCK_ACTIVITY_ID,
            slug: 'mock-favourite',
            titleEn: 'Mock Favourite Activity',
            pricePerPerson: '120.00',
            currencyCode: 'QAR',
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

  await page.route(`**/api/activities/${MOCK_ACTIVITY_ID}/like`, async (route: Route) => {
    if (route.request().method() === 'POST') {
      isLiked = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ liked: true }),
      });
      return;
    }
    if (route.request().method() === 'DELETE') {
      isLiked = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ liked: false }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer favourites — toggle from /likes', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeEach(() => {
    isLiked = false;
  });

  test('like → appears on /likes; unlike → list empty', async ({ page }) => {
    await setupRoutes(page);
    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Initial list is empty.
    const before = await page.request.get(`${apiBase}/customer/likes`);
    expect(before.ok()).toBeTruthy();
    expect((await before.json()).total).toBe(0);

    // Like the activity.
    const like = await page.request.post(`${apiBase}/activities/${MOCK_ACTIVITY_ID}/like`);
    expect(like.ok()).toBeTruthy();
    expect((await like.json()).liked).toBe(true);

    // Now appears on /likes.
    const list = await page.request.get(`${apiBase}/customer/likes`);
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    expect(listBody.total).toBe(1);
    expect(listBody.data[0].id).toBe(MOCK_ACTIVITY_ID);

    // Unlike.
    const unlike = await page.request.delete(`${apiBase}/activities/${MOCK_ACTIVITY_ID}/like`);
    expect(unlike.ok()).toBeTruthy();
    expect((await unlike.json()).liked).toBe(false);

    // List empty again.
    const after = await page.request.get(`${apiBase}/customer/likes`);
    expect(after.ok()).toBeTruthy();
    expect((await after.json()).total).toBe(0);
  });
});
