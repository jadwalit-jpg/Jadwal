/**
 * Visual regression — 5 customer landing pages × 2 languages (EN + AR).
 *
 * First run generates the baseline PNGs (committed to git alongside the
 * spec file). Subsequent runs diff against the baseline; any pixel
 * difference > maxDiffPixels fails the spec.
 *
 * Per Playwright skill §10:
 *   - Reduced motion to kill any time-based animations during capture.
 *   - Fixed viewport (Playwright default 1280×720 for chromium).
 *   - mask the activity card images (volatile — different rows on
 *     different runs depending on which activities exist in the test DB).
 *
 * To regenerate baselines after an intentional UI change:
 *   npx playwright test e2e/visual-landing-pages.spec.ts --update-snapshots
 *
 * NEVER run --update-snapshots without reviewing the diff in
 * test-results/ first — this is the same rule as committing screenshot
 * goldens in any other tool.
 */

import { test, expect } from '@playwright/test';

const PAGES = ['/', '/explore', '/login', '/register', '/about'] as const;

// Skip in CI until Linux baselines are committed. Visual baselines are
// platform-dependent (antialiasing, font hinting); a Windows/macOS dev
// machine cannot generate baselines that match Ubuntu CI runners.
// To enable: locally run inside a Linux container, commit the .png
// snapshots, then remove the skip.
test.skip(
  !!process.env.CI,
  'Visual baselines must be Linux-generated; commit them then remove this skip',
);

for (const path of PAGES) {
  for (const lang of ['en', 'ar'] as const) {
    test(`visual: ${path} (${lang})`, async ({ page }) => {
      // Set the lang cookie BEFORE navigation so SSR + client agree on dir.
      await page.context().addCookies([
        { name: 'jadwal_lang', value: lang, url: 'http://localhost:3000' },
      ]);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Mask volatile regions:
      //   - Activity card images (different on each run depending on seed)
      //   - Anything timestamp-y (date counters that include "today")
      const masks = [
        page.locator('img[src*="/uploads/"]'),
        page.locator('[data-testid="activity-card"] img'),
        page.locator('[suppresshydrationwarning]'),
      ];

      await expect(page).toHaveScreenshot(`landing-${path.replace(/\//g, '_') || 'home'}-${lang}.png`, {
        fullPage: true,
        // Tolerant to minor anti-aliasing / font-shape variance + 1-2px
        // height drift between runs (lazy images, content reflow).
        maxDiffPixels: 15000,
        maxDiffPixelRatio: 0.05,
        mask: masks,
        animations: 'disabled',
      });
    });
  }
}
