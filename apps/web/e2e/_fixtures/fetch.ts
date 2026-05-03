/**
 * Browser-fetch helper for Playwright specs.
 *
 * Why this exists: Playwright's `page.request.*` methods use a separate
 * APIRequestContext that does NOT go through `page.route()` mocks. Specs
 * that mock an endpoint via page.route() and then call page.request hit
 * the real network and skip the mock entirely (typical symptom: spec
 * fails in 200-300ms because the real API returns 404 or 401).
 *
 * The fix: use `page.evaluate(() => fetch(...))`. The `fetch` runs inside
 * the loaded page's context, so the request flows through the browser's
 * network stack — and `page.route()` intercepts every browser-issued
 * request. This restores the contract that the spec's route mocks
 * actually fire.
 *
 * Usage:
 *   await page.goto('/some-page');           // any page so evaluate has a context
 *   await page.route('**\/api/foo', mock);
 *   const { status, body } = await fetchFromPage(page, '/api/foo', {
 *     method: 'POST',
 *     body: JSON.stringify({ x: 1 }),
 *   });
 */
import type { Page } from '@playwright/test';

export interface FetchResult<T = unknown> {
  status: number;
  ok: boolean;
  body: T | null;
}

export async function fetchFromPage<T = unknown>(
  page: Page,
  url: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<FetchResult<T>> {
  return page.evaluate(
    async ({ url, init }) => {
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        body: init.body,
        credentials: 'include',
      });
      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return { status: res.status, ok: res.ok, body };
    },
    { url, init },
  ) as Promise<FetchResult<T>>;
}
