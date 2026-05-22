/**
 * Parse the comma-separated `CORS_ORIGIN` env var into a validated and
 * NORMALIZED string[] of origins. Throws on any malformed entry so bootstrap
 * fails-fast at startup instead of silently dropping requests from a typo'd
 * origin.
 *
 * Each entry must:
 *   - parse as a valid URL via WHATWG `new URL(...)`
 *   - use `http:` or `https:` scheme — never `file:`, `chrome-extension:`,
 *     `data:`, or anything else that doesn't make sense as a CORS origin.
 *
 * Returns the canonical `URL.origin` for each entry ("scheme://host[:port]",
 * never with a trailing slash or path). This matters: Express's `cors`
 * middleware does **exact string comparison** when `origin` is `string[]`,
 * but browsers send the request `Origin` header as just `scheme://host`.
 * If we passed through a raw `https://jadwal.qa/` (trailing slash) or
 * `https://jadwal.qa/path` from the env var, every cross-origin request
 * would be silently rejected at runtime. Normalising here makes the env
 * var forgiving for the operator and exact for the matcher.
 *
 * Whitespace around entries is trimmed; empty entries are dropped silently
 * so a trailing comma is forgiving rather than fatal.
 */
export function parseCorsOrigins(raw: string): string[] {
  const entries = raw.split(',').map((o) => o.trim()).filter(Boolean);
  const normalized: string[] = [];
  for (const o of entries) {
    let u: URL;
    try {
      u = new URL(o);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Malformed CORS_ORIGIN entry "${o}": ${cause}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(
        `Malformed CORS_ORIGIN entry "${o}": scheme must be http/https, got "${u.protocol}"`,
      );
    }
    normalized.push(u.origin);
  }
  return normalized;
}
