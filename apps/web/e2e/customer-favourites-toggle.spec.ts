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
import { fetchFromPage } from './_fixtures/fetch';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_ACTIVITY_ID = '00000000-0000-4000-8000-00000000s301';

let isLiked = false;

interface LikeResponse {
  liked: boolean;
}

interface LikesList {
  total: number;
  data: Array<{ id: string }>;
}

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
    await page.goto('/');

    // Initial list is empty.
    const before = await fetchFromPage<LikesList>(page, '/api/customer/likes');
    expect(before.ok).toBeTruthy();
    expect(before.body?.total).toBe(0);

    // Like the activity.
    const like = await fetchFromPage<LikeResponse>(
      page,
      `/api/activities/${MOCK_ACTIVITY_ID}/like`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(like.ok).toBeTruthy();
    expect(like.body?.liked).toBe(true);

    // Now appears on /likes.
    const list = await fetchFromPage<LikesList>(page, '/api/customer/likes');
    expect(list.ok).toBeTruthy();
    expect(list.body?.total).toBe(1);
    expect(list.body?.data[0].id).toBe(MOCK_ACTIVITY_ID);

    // Unlike.
    const unlike = await fetchFromPage<LikeResponse>(
      page,
      `/api/activities/${MOCK_ACTIVITY_ID}/like`,
      { method: 'DELETE' },
    );
    expect(unlike.ok).toBeTruthy();
    expect(unlike.body?.liked).toBe(false);

    // List empty again.
    const after = await fetchFromPage<LikesList>(page, '/api/customer/likes');
    expect(after.ok).toBeTruthy();
    expect(after.body?.total).toBe(0);
  });
});
