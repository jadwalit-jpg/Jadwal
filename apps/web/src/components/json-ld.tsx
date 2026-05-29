/**
 * JSON-LD structured-data emitter (schema.org) for SEO rich results.
 *
 * SECURITY — this is the ONE sanctioned use of `dangerouslySetInnerHTML`
 * in the app. The app-wide ban (ESLint `no-restricted-syntax` in
 * eslint.config.mjs + the `dangerouslySetInnerHTML` grep in ci.yml) exists
 * to stop ATTACKER-CONTROLLED strings becoming executable DOM. That risk
 * does not apply here:
 *   - `data` is always a SERVER-constructed object (Organization, Product,
 *     BreadcrumbList, …) — never raw user HTML.
 *   - It is JSON.stringify'd, and every `<` is escaped to `<`, so a
 *     field that happens to contain "</script>" cannot break out of the tag.
 * The ban stays fully active for every other file; only this audited file
 * is exempted, by name, in both gates. React entity-escapes text children
 * of <script>, which corrupts JSON-LD, so raw injection is the only correct
 * way to emit it (this is the pattern the Next.js docs recommend).
 */

type JsonLdData = Record<string, unknown>;

export function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line no-restricted-syntax -- audited JSON-LD emitter; see file header
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
