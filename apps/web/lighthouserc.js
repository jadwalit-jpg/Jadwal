/**
 * Lighthouse CI config — 5 gate pages, PRODUCTION build.
 *
 * Run locally (recommended):
 *   1. docker compose --profile lighthouse up -d --build web-prod
 *      (builds the prod bundle in a one-off container on host port 3001;
 *       leaves the dev server on :3000 untouched)
 *   2. cd apps/web && npx lhci autorun
 *   3. docker compose --profile lighthouse stop web-prod   # tear down
 *
 * For a quick dev-server pass (perf scores will be unreliable):
 *   npx lhci autorun --config=lighthouserc.dev.js
 *
 * The thresholds below are the production launch gates. Adjust upward
 * once the app stabilises; do not loosen without a written reason.
 *
 * Categories (all 0..1):
 *   - performance     — LCP, TBT, CLS, FCP, SI
 *   - accessibility   — axe-style rules baked in
 *   - best-practices  — modern web hygiene (HTTPS, no errors, etc.)
 *   - seo             — title, meta, lang, robots
 *
 * Exclusions: PWA category is not gated (no installable manifest yet).
 */
module.exports = {
  ci: {
    collect: {
      // Public, no-auth pages only — every page must work without a session.
      // Activity-detail / vendor-dashboard / booking-flow are gated separately
      // because they require auth bootstrap (see Playwright skill §6).
      // Port 3001 — the prod web-prod compose service. Dev stays on 3000.
      url: [
        'http://localhost:3001/',
        'http://localhost:3001/explore',
        'http://localhost:3001/login',
        'http://localhost:3001/register',
        'http://localhost:3001/about',
      ],
      numberOfRuns: 3,
      settings: {
        // Mobile emulation + 4G slow-throttling are the Lighthouse defaults
        // for mobile audits — that's the lowest-end device our GCC customer
        // base browses on. No preset needed (the 'mobile' shorthand isn't
        // a Lighthouse preset; only 'perf', 'experimental', 'desktop' are).
        chromeFlags: ['--no-sandbox', '--disable-dev-shm-usage'],
      },
    },
    assert: {
      assertions: {
        // ─── Performance ──────────────────────────────────────────
        // LCP <= 2.5s is Google's "good" bucket. Hard gate.
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        // TBT <= 200ms keeps the main thread responsive on mid-range phones.
        'total-blocking-time':      ['error', { maxNumericValue: 200 }],
        // CLS <= 0.1 prevents jarring layout shifts.
        'cumulative-layout-shift':  ['error', { maxNumericValue: 0.1 }],

        // ─── Category aggregates ──────────────────────────────────
        // Performance score >= 0.85 — accounts for the always-some-jitter
        // nature of Lighthouse runs across builds.
        'categories:performance':    ['error', { minScore: 0.85 }],
        // A11y score >= 0.95 — auth forms are still missing label/htmlFor
        // associations (known issue, tracked separately). Once those land
        // raise this to 1.0 and gate at error-level.
        'categories:accessibility':  ['warn',  { minScore: 0.95 }],
        // Best practices >= 0.95 — modern web hygiene.
        'categories:best-practices': ['error', { minScore: 0.95 }],
        // SEO >= 0.95 — title, meta, viewport, lang.
        'categories:seo':            ['error', { minScore: 0.95 }],

        // PWA is not yet a launch criterion — opt out explicitly so
        // upstream LHCI defaults don't gate on it.
        'categories:pwa': 'off',
      },
    },
    upload: {
      // Local mode only — no LHCI server. Reports go to .lighthouseci/
      target: 'filesystem',
      outputDir: './.lighthouseci',
      reportFilenamePattern: 'lh-%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%',
    },
    server: {},
    wizard: {},
  },
};
