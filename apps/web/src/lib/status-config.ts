/**
 * Shared status/role enum unions + a safe badge-lookup helper.
 *
 * Background: the `/admin/activities` table crashed in prod because its status
 * badge map was typed `Record<string, Badge>` and was missing the `INACTIVE`
 * key, so `map[activity.status].icon` read `undefined` at runtime. TypeScript
 * could not catch it — indexing a `Record<string, T>` returns `T`, never
 * `T | undefined` (no `noUncheckedIndexedAccess`).
 *
 * The fix is two layers, applied across every actor (admin / vendor / customer):
 *   1. COMPILE-TIME — type each badge map as `Record<<Enum>, Badge>` (exhaustive).
 *      The build then FAILS if a config is missing an enum value, so the
 *      INACTIVE-class bug can never reach prod again.
 *   2. RUNTIME — look the value up via `pickBadge(map, key, fallback)`, which
 *      returns a safe fallback if the API ever sends a value the frontend enum
 *      doesn't know yet (enum drift). So even an unforeseen status never crashes
 *      a page.
 *
 * The unions below MIRROR the Prisma enums (apps/api/prisma/schema.prisma). Keep
 * them in sync when an enum gains a value — the exhaustive `Record` typing will
 * flag every badge map that needs the new key.
 */

export type ActivityStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type CouponStatus = 'PENDING' | 'APPROVED' | 'EXPIRED';
export type VendorStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';
export type UserRole = 'CUSTOMER' | 'VENDOR' | 'ADMIN';
export type PayoutRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

/**
 * Safe lookup into a badge/config map. Returns `map[key]`, or `fallback` when
 * `key` is null/undefined or absent from the map (defends against enum drift —
 * an API value the frontend union doesn't model yet). An exhaustively-typed map
 * (`Record<SomeEnum, T>`) plus this helper = no possible runtime crash.
 */
export function pickBadge<T>(
  map: Record<string, T>,
  key: string | null | undefined,
  fallback: T,
): T {
  return (key != null ? map[key] : undefined) ?? fallback;
}
