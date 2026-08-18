/**
 * E2E — responsive layout guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * The vendor UI shipped to production with elements stacked on top of each
 * other on mobile: the sidebar's `fixed` hamburger sat on top of every page
 * heading, `refund-requests` had an unconditional `ps-64` (256px of dead
 * padding on a 390px phone), and four tables were clipped — their columns
 * literally unreachable — because they sat inside an `overflow-x-hidden` main
 * with no scroll container.
 *
 * The E2E suite already ran on mobile-chrome and did NOT catch any of it,
 * because every existing spec asserts BEHAVIOUR, not LAYOUT. An overlapping
 * button still clicks fine — Playwright finds it by selector and clicks it, so
 * the tests stayed green while the UI was visibly broken.
 *
 * This spec asserts the things a human notices and a click-based test cannot:
 *   1. nothing overflows the viewport unless it lives in a scroll container
 *      (i.e. content is CLIPPED and unreachable, not scrollable),
 *   2. the page does not scroll sideways,
 *   3. a fixed control (the sidebar hamburger) does not cover the page heading.
 *
 * It runs at a phone viewport across customer, vendor and admin surfaces.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsVendor, loginAsAdmin, vendorSlugFromMe } from './_fixtures/auth';

// A real phone. Narrow enough to expose the bugs above.
test.use({ viewport: { width: 390, height: 844 } });

type LayoutReport = {
  horizontalScroll: boolean;
  clippedCount: number;
  clipped: string[];
  headingCoveredByFixedControl: boolean;
};

async function auditLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const root: Element = document.querySelector('main') ?? document.body;

    // An element hanging outside the viewport is FINE if some ancestor scrolls
    // horizontally (carousels, wrapped tables). It is a BUG if nothing does —
    // then it is clipped and the user can never reach it.
    const inScrollContainer = (el: Element): boolean => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
        p = p.parentElement;
      }
      return false;
    };

    // Purely decorative art (hero sun/clouds/waves) is `aria-hidden` +
    // `pointer-events-none` and is deliberately bled past the edge inside an
    // `overflow-hidden` frame. Clipping it is the DESIGN, not a bug — only
    // real, reachable CONTENT matters here.
    const isDecorative = (el: Element): boolean => {
      let p: Element | null = el;
      while (p && p !== document.body) {
        if (p.getAttribute('aria-hidden') === 'true') return true;
        if (getComputedStyle(p).pointerEvents === 'none') return true;
        p = p.parentElement;
      }
      return false;
    };

    const clipped: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      // Fixed/sticky chrome (hamburger, banners, floats) is positioned on
      // purpose and is handled by the overlap check below instead.
      if (cs.position === 'fixed' || cs.position === 'sticky') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (isDecorative(el)) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const outside = r.right > window.innerWidth + 1 || r.left < -1;
      if (outside && !inScrollContainer(el)) {
        const cls = typeof el.className === 'string' ? el.className : '';
        clipped.push(`${el.tagName.toLowerCase()}.${cls.trim().split(/\s+/).slice(0, 3).join('.')}`);
      }
    }

    const hit = (a: DOMRect, b: DOMRect) =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

    // The vendor sidebar toggle is `fixed top-4 start-4`. If the page content
    // does not clear it, it lands on top of the <h1> — the reported bug.
    const fixedBtn = document.querySelector('button.fixed');
    const heading = document.querySelector('h1');
    const headingCoveredByFixedControl =
      !!fixedBtn &&
      !!heading &&
      hit(fixedBtn.getBoundingClientRect(), heading.getBoundingClientRect());

    return {
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      clippedCount: clipped.length,
      clipped: Array.from(new Set(clipped)).slice(0, 8),
      headingCoveredByFixedControl,
    };
  });
}

/** Consent banner overlays content and can skew measurements — dismiss it. */
async function dismissConsent(page: Page) {
  const btn = page.getByRole('button', { name: /accept|decline|موافق|رفض/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(200);
  }
}

/**
 * Guard against a VACUOUS pass. If auth fails, the app redirects to a login
 * page — which is itself perfectly responsive — so the audit would happily pass
 * while never having seen the page under test. Assert we actually landed.
 */
async function assertOnPage(page: Page, expectedPath: string) {
  const url = new URL(page.url());
  expect(
    url.pathname,
    `expected to be on ${expectedPath} but landed on ${url.pathname} ` +
      `(auth redirect?) — this test would otherwise pass vacuously`,
  ).toContain(expectedPath);
}

async function expectResponsive(page: Page, label: string) {
  // Measure only once the page has actually rendered. Auditing mid-render gave
  // false positives (skeletons / half-laid-out grids briefly overflow).
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .locator('main h1, main table, main [class*="grid"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

  // Below-the-fold islands hydrate lazily and render skeletons first. Measuring
  // mid-load flagged the skeleton row instead of the real content — wait it out.
  await page
    .locator('.jadwal-skeleton')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => {});

  await dismissConsent(page);
  await page.waitForTimeout(400); // let layout settle after the banner closes

  const r = await auditLayout(page);

  expect(
    r.clippedCount,
    `${label}: ${r.clippedCount} element(s) overflow the viewport with no scrollable ancestor — ` +
      `they are CLIPPED and unreachable on mobile: ${r.clipped.join(', ')}`,
  ).toBe(0);

  expect(r.horizontalScroll, `${label}: the page scrolls sideways on a phone`).toBe(false);

  expect(
    r.headingCoveredByFixedControl,
    `${label}: a fixed control (sidebar hamburger) is sitting on top of the page heading`,
  ).toBe(false);
}

/* ── Customer surface (public) ─────────────────────────────────────────── */

for (const path of ['/', '/explore', '/offers']) {
  test(`responsive: customer ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectResponsive(page, `customer ${path}`);
  });
}

/* ── Vendor surface — where the reported bugs lived ────────────────────── */

test.describe('responsive: vendor', () => {
  const PAGES = ['dashboard', 'activities', 'bookings', 'coupons', 'earnings', 'refund-requests'];

  for (const p of PAGES) {
    test(`responsive: vendor /${p}`, async ({ page }) => {
      await loginAsVendor(page);
      const slug = await vendorSlugFromMe(page);
      test.skip(!slug, 'no vendor slug — seed data unavailable');

      await page.goto(`/vendor/${slug}/${p}`);
      await assertOnPage(page, `/vendor/${slug}/${p}`);
      await expectResponsive(page, `vendor /${p}`);
    });
  }
});

/* ── Admin surface ─────────────────────────────────────────────────────── */

test.describe('responsive: admin', () => {
  // Every admin route (login is excluded — it has no sidebar/shell).
  const PAGES = [
    'dashboard',
    'activities',
    'bookings',
    'vendors',
    'users',
    'coupons',
    'payouts',
    'payout-requests',
    'refunds',
    'reviews',
    'loyalty',
    'categories',
    'cities',
    'trending',
    'audit-logs',
    'email-suppressions',
    'settings',
    'profile',
  ];

  for (const p of PAGES) {
    test(`responsive: admin /${p}`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(`/admin/${p}`);
      await assertOnPage(page, `/admin/${p}`);
      await expectResponsive(page, `admin /${p}`);
    });
  }
});
