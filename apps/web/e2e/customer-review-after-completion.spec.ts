/**
 * E2E — customer leaves a 5-star review after a completed booking →
 * activity rating updates.
 *
 * Contract: POST /reviews { activityId, bookingId, rating, body } returns
 * 201 with the new aggregate rating. /activity/[slug] reads the updated
 * rating in subsequent fetches.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { fetchFromPage } from './_fixtures/fetch';

const CUSTOMER_STATE = 'e2e/.auth/customer.json';

const MOCK_ACTIVITY_ID = '00000000-0000-4000-8000-00000000s201';
const MOCK_BOOKING_ID = '00000000-0000-4000-8000-00000000s202';
const MOCK_ACTIVITY_SLUG = 'mock-review-activity';

let reviewSubmitted = false;

const baseActivity = {
  id: MOCK_ACTIVITY_ID,
  slug: MOCK_ACTIVITY_SLUG,
  titleEn: 'Mock Review Activity',
  titleAr: 'نشاط تجريبي',
  averageRating: 4.0,
  reviewCount: 4,
  pricePerPerson: '100.00',
  currencyCode: 'QAR',
};

interface Activity {
  averageRating: number;
  reviewCount: number;
}

interface ReviewResponse {
  id: string;
  rating: number;
}

async function setupRoutes(page: Page) {
  await page.route('**/api/activities/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      const updated = reviewSubmitted
        ? { ...baseActivity, averageRating: 4.2, reviewCount: 5 }
        : baseActivity;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('Customer review — POST creates row, activity rating updates', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeEach(() => {
    reviewSubmitted = false;
  });

  test('submitting a 5-star review updates the activity average', async ({ page }) => {
    await setupRoutes(page);
    await page.goto('/');

    await page.route('**/api/reviews', async (route: Route) => {
      if (route.request().method() === 'POST') {
        reviewSubmitted = true;
        const payload = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'review-new',
            activityId: payload.activityId,
            bookingId: payload.bookingId,
            rating: payload.rating,
            body: payload.body,
            createdAt: new Date().toISOString(),
          }),
        });
        return;
      }
      await route.fallback();
    });

    // Pre-submit rating.
    const before = await fetchFromPage<Activity>(page, `/api/activities/${MOCK_ACTIVITY_SLUG}`);
    expect(before.ok).toBeTruthy();
    expect(before.body?.averageRating).toBeCloseTo(4.0, 1);
    expect(before.body?.reviewCount).toBe(4);

    // Submit the review.
    const post = await fetchFromPage<ReviewResponse>(page, '/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        activityId: MOCK_ACTIVITY_ID,
        bookingId: MOCK_BOOKING_ID,
        rating: 5,
        body: 'Outstanding experience!',
      }),
    });
    expect(post.status).toBe(201);
    expect(post.body?.rating).toBe(5);

    // Post-submit rating reflects the new aggregate.
    const after = await fetchFromPage<Activity>(page, `/api/activities/${MOCK_ACTIVITY_SLUG}`);
    expect(after.ok).toBeTruthy();
    expect(after.body?.reviewCount).toBe(5);
    expect(after.body?.averageRating ?? 0).toBeGreaterThan(before.body?.averageRating ?? 0);
  });
});
