/**
 * Lighthouse CI config — DEV-SERVER variant.
 *
 * Use this to get a11y / SEO / best-practices signal against the running
 * `next dev` server (port 3000 in docker). Performance scores are NOT
 * reliable in dev mode (no minification, source maps, HMR overhead) so the
 * perf gate is downgraded to 'warn' here. For real perf gating, run a
 * production build first then use lighthouserc.js.
 *
 *   npx lhci autorun --config=lighthouserc.dev.js
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/explore',
        'http://localhost:3000/login',
        'http://localhost:3000/register',
        'http://localhost:3000/about',
      ],
      // Single run is enough in dev mode — variance is high anyway.
      numberOfRuns: 1,
      settings: {
        // Mobile emulation is the Lighthouse default (no preset needed).
        chromeFlags: ['--no-sandbox', '--disable-dev-shm-usage'],
      },
    },
    assert: {
      assertions: {
        // Perf metrics are unreliable in dev mode — keep as warnings only.
        'largest-contentful-paint': 'off',
        'total-blocking-time':      'off',
        'cumulative-layout-shift':  ['warn', { maxNumericValue: 0.25 }],
        'categories:performance':   'off',

        // These three remain meaningful in dev mode.
        'categories:accessibility':  ['warn',  { minScore: 0.95 }],
        'categories:best-practices': ['warn',  { minScore: 0.90 }],
        'categories:seo':            ['warn',  { minScore: 0.90 }],

        'categories:pwa': 'off',
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './.lighthouseci',
      reportFilenamePattern: 'lh-dev-%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%',
    },
    server: {},
    wizard: {},
  },
};
