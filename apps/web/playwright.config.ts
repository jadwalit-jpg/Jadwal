import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retry once locally too — dev server compile-on-demand can take 10-20s
  // for cold pages, which races a 30s test timeout under suite load.
  retries: process.env.CI ? 2 : 1,
  // Slightly longer per-test budget so cold compiles + auth-context settle
  // don't trip the default 30 s.
  timeout: 60_000,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    // Override at runtime with PLAYWRIGHT_BASE_URL — useful for running
    // the suite against the prod-build container at :3001 (the dev server
    // on :3000 has a Tailwind v4 + Next.js 15 dev-mode bug that breaks
    // styling on WebKit-engine browsers).
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    // Safari (desktop) — runs only when explicitly invoked
    // (--project=webkit) to avoid doubling local-run time.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
    // Mobile coverage — Jadwal is a GCC marketplace where most customer
    // traffic is on phones. The admin + vendor portals are explicitly
    // desktop-only (full-width sidebar layouts, table-heavy CRUD views),
    // so we skip those spec families here. Customer flows + landing
    // pages run on mobile as the real coverage target.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
      testIgnore: /(admin-|vendor-).+\.spec\.ts$/,
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
      testIgnore: /(admin-|vendor-).+\.spec\.ts$/,
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
