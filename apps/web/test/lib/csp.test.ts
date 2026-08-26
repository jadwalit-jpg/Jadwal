/**
 * CSP beacon-host coverage.
 *
 * THE BUG THIS EXISTS TO PREVENT, because it already happened once. GA4 went in
 * with `https://www.googletagmanager.com` on `connect-src` — that is where
 * gtag.js is DOWNLOADED from. GA4 sends its actual hits somewhere else
 * entirely, `https://www.google-analytics.com/g/collect`, which was never
 * allowlisted. So the tag loaded, ran, cost real main-thread time on every page
 * view, and every single hit was blocked by CSP.
 *
 * Nothing caught it. The page rendered perfectly, no test failed, no error
 * surfaced server-side — the only evidence was a red line in the browser
 * console that nobody had open. It was found by accident weeks later.
 *
 * That is the trap: for every one of these tools the SCRIPT HOST and the
 * BEACON HOST are different, and only the script host is visible in the code
 * that loads it. So these tests assert the beacon hosts specifically.
 *
 * If you add or change an analytics tool, add its beacon host here and watch
 * this fail first.
 */
// `middleware.ts` imports `next/server`, which subclasses the Edge-runtime
// globals at import time. jsdom does not define them (and the shared
// jest.setup.ts needs jsdom's `window`, so switching this file to the node
// environment is not an option). Minimal stubs are enough: nothing here
// constructs a Request — buildCsp is a pure string builder.
for (const name of ['Request', 'Response', 'Headers'] as const) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g[name] === 'undefined') g[name] = class {};
}

// Required, not imported: the stubs above must exist BEFORE `next/server` is
// evaluated, and `import` statements are hoisted above them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildCsp } = require('@/middleware') as typeof import('@/middleware');

const NONCE = 'test-nonce-value';

/** Pull one directive's source list out of the policy string. */
function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`directive "${name}" not present in CSP`);
  return found;
}

/**
 * Whether `host` is permitted, honouring a `*.` wildcard entry.
 * `https://*.google-analytics.com` must satisfy `https://www.google-analytics.com`.
 */
function allows(sources: string, host: string): boolean {
  const url = new URL(host);
  return sources.split(/\s+/).slice(1).some((src) => {
    if (src === host || src === url.origin) return true;
    if (!src.includes('*')) return false;
    const pattern = new RegExp(
      '^' + src.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+') + '$',
    );
    return pattern.test(url.origin);
  });
}

const csp = buildCsp(NONCE, true);

describe('CSP — analytics beacon hosts must be reachable', () => {
  const connect = directive(csp, 'connect-src');

  test.each([
    ['GA4 hits', 'https://www.google-analytics.com'],
    ['GA4 regional hits', 'https://region1.google-analytics.com'],
    ['GA4 alternate host', 'https://analytics.google.com'],
    ['Google Ads conversion', 'https://googleads.g.doubleclick.net'],
    ['DoubleClick match', 'https://ad.doubleclick.net'],
    ['Meta Pixel hits', 'https://www.facebook.com'],
    ['Clarity upload', 'https://c.clarity.ms'],
  ])('connect-src allows %s', (_label, host) => {
    expect(allows(connect, host)).toBe(true);
  });

  test('connect-src still allows the gtag.js DOWNLOAD host', () => {
    // Necessary but not sufficient — allowlisting only this was the original bug.
    expect(allows(connect, 'https://www.googletagmanager.com')).toBe(true);
  });
});

describe('CSP — Google Ads remarketing image beacons', () => {
  const img = directive(csp, 'img-src');

  test.each([
    ['Qatar', 'https://www.google.com.qa'],
    ['UAE', 'https://www.google.ae'],
    ['Saudi Arabia', 'https://www.google.com.sa'],
    ['generic', 'https://www.google.com'],
  ])('img-src allows the %s Google domain', (_label, host) => {
    // Google Ads pings the visitor's COUNTRY domain, not google.com. CSP cannot
    // wildcard a TLD, so the markets we sell in are listed explicitly.
    expect(allows(img, host)).toBe(true);
  });
});

describe('CSP — the security properties that must not regress', () => {
  test('script-src is nonce-based with strict-dynamic', () => {
    const script = directive(csp, 'script-src');
    expect(script).toContain(`'nonce-${NONCE}'`);
    expect(script).toContain(`'strict-dynamic'`);
  });

  test('production script-src has NO unsafe-eval', () => {
    // Adding this to run a third-party tag would be a real downgrade: it is
    // what turns an XSS foothold into arbitrary code execution.
    expect(directive(csp, 'script-src')).not.toContain('unsafe-eval');
  });

  test('production script-src has NO unsafe-inline', () => {
    expect(directive(csp, 'script-src')).not.toContain(`'unsafe-inline'`);
  });

  test('object-src and frame-ancestors stay locked down', () => {
    expect(directive(csp, 'object-src')).toContain(`'none'`);
    expect(directive(csp, 'frame-ancestors')).toContain(`'none'`);
  });

  test('widening a beacon host must not widen script-src', () => {
    // The beacon hosts above are data endpoints. None of them should become a
    // place scripts can be loaded from.
    const script = directive(csp, 'script-src');
    for (const host of ['google-analytics.com', 'doubleclick.net', 'clarity.ms']) {
      expect(script).not.toContain(host);
    }
  });
});
