/**
 * Frontend unit-test config (Jest + jsdom + React Testing Library).
 *
 * Scope: @/lib utilities, React hooks, components that render without a
 * full page context. Playwright covers E2E flows (see apps/web/e2e/ and the
 * /playwright skill) — do NOT duplicate flow tests here.
 *
 * Run:   `cd jadwal/apps/web && npm test`
 * Watch: `cd jadwal/apps/web && npm test -- --watch`
 * CI:    runs in the frontend-unit job, no network, no dev server needed.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: { jsx: 'react-jsx', esModuleInterop: true, allowJs: true },
      diagnostics: { ignoreCodes: ['TS151001'] },
    }],
  },
  moduleNameMapper: {
    // Tailwind / CSS modules → identity proxy so className strings stay
    // readable in assertions without importing real styles.
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    // Static asset imports (SVG / PNG) — stub to a filename string.
    '\\.(svg|png|jpg|jpeg|gif|webp|avif)$': '<rootDir>/test/__mocks__/file-mock.ts',
    // Respect the @/* path alias the app uses.
    '^@/(.*)$': '<rootDir>/src/$1',
    // Leaflet + framer-motion + recharts break in jsdom; stub them out when
    // imported by a unit-under-test. Lighter than trying to polyfill canvas.
    '^leaflet$': '<rootDir>/test/__mocks__/leaflet.ts',
    '^framer-motion$': '<rootDir>/test/__mocks__/framer-motion.tsx',
    '^next/link$': '<rootDir>/test/__mocks__/next-link.tsx',
    '^next/image$': '<rootDir>/test/__mocks__/next-image.tsx',
    '^next/navigation$': '<rootDir>/test/__mocks__/next-navigation.ts',
    '^next-themes$': '<rootDir>/test/__mocks__/next-themes.tsx',
  },
  testMatch: [
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/test/**/*.test.tsx',
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.test.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/\\.next/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Reset mocks & timers between tests so one spec's state can't leak into
  // the next. Cheap insurance against order-dependent flakes.
  clearMocks: true,
  restoreMocks: true,
  resetModules: true,
};
