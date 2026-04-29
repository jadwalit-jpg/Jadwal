/**
 * Environment-variable helpers that handle the dev/prod asymmetry safely.
 *
 * Why these exist:
 *   - In dev, dotenv parses `FOO=` as "FOO not set" — process.env.FOO is undefined.
 *   - In prod under ECS + SSM injection, an SSM Parameter Store entry with an
 *     empty value comes through as process.env.FOO = "" (an empty string).
 *
 * `process.env.X ?? fallback` only short-circuits on null/undefined, NOT on the
 * empty string — so a stray empty SSM parameter silently overrides the default
 * with garbage:
 *
 *     Number(process.env.PARTIAL_REFUND_PERCENT ?? 50)
 *       // SSM empty -> Number("") = 0 -> 0% refund (silent money bug)
 *
 *     app.listen(process.env.PORT ?? 4000)
 *       // SSM empty -> app.listen("") -> random port -> ALB health checks fail
 *
 * These helpers treat undefined AND empty string identically as "fall back
 * to default" — closing the SSM-empty-value gap. Explicit "0" / "false" /
 * "non-empty string" still round-trip, so e.g. `PARTIAL_REFUND_PERCENT=0`
 * still means a real 0% refund. Empty string is the ONLY value that's
 * treated as "missing" in the same way undefined is.
 */

export function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function envString(key: string, fallback: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v;
}

export function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}
