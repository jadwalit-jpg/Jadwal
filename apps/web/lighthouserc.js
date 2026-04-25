/**
 * Lighthouse CI config — 5 gate pages.
 *
 * Run locally:
 *   1. npm run build
 *   2. npm start             (in another terminal)
 *   3. npx lhci autorun
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
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/explore',
        'http://localhost:3000/login',
        'http://localhost:3000/register',
        'http://localhost:3000/about',
      ],
      numberOfRuns: 3,
      settings: {
        // Throttling: simulate a realistic 4G phone — that is the lowest-end
        // device our GCC customer base browses on. Don't loosen.
        preset: 'mobile',
        // Disable the storage-clearing prompt so unattended runs don't hang
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
