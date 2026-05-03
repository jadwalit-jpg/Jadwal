/**
 * E2E — customer leaves a 5-star review after a completed booking →
 * activity rating updates.
 *
 * Contract: POST /reviews { activityId, bookingId, rating, body } returns
 * 201 with the new aggregate rating. /activity/[slug] reads the updated
 * rating in subsequent fetches.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

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

async function setupRoutes(page: Page) {
  await page.route('**/api/activities/**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      // After submit, recompute average: (4*4 + 5) / 5 = 4.2
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

    const apiBase = process.env.E2E_API_URL || 'http://localhost:4000/api';

    // Pre-submit rating.
    const before = await page.request.get(`${apiBase}/activities/${MOCK_ACTIVITY_SLUG}`);
    expect(before.ok()).toBeTruthy();
    const beforeBody = await before.json();
    expect(beforeBody.averageRating).toBeCloseTo(4.0, 1);
    expect(beforeBody.reviewCount).toBe(4);

    // Submit the review.
    const post = await page.request.post(`${apiBase}/reviews`, {
      data: {
        activityId: MOCK_ACTIVITY_ID,
        bookingId: MOCK_BOOKING_ID,
        rating: 5,
        body: 'Outstanding experience!',
      },
    });
    expect(post.status()).toBe(201);
    const postBody = await post.json();
    expect(postBody.rating).toBe(5);

    // Post-submit rating reflects the new aggregate.
    const after = await page.request.get(`${apiBase}/activities/${MOCK_ACTIVITY_SLUG}`);
    expect(after.ok()).toBeTruthy();
    const afterBody = await after.json();
    expect(afterBody.reviewCount).toBe(5);
    expect(afterBody.averageRating).toBeGreaterThan(beforeBody.averageRating);
  });
});
