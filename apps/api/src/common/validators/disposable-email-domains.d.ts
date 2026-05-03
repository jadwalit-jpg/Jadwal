// Type shim for the data-only `disposable-email-domains` npm package.
// Upstream ships no .d.ts; the export is a string[] of lowercase domain
// names sourced from a community-maintained JSON list.
declare module 'disposable-email-domains' {
  const domains: string[];
  export = domains;
}
