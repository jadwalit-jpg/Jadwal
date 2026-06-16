'use client';

/**
 * Loading skeleton for the lazy below-fold (`home-below-fold.tsx`).
 *
 * Used in TWO places so the hand-off is seamless — same markup, no shape
 * change as the page goes from "chunk downloading" → "component mounted,
 * queries loading" → "data in":
 *   - `home-below-fold-loader.tsx` — the `dynamic({ loading })` state shown
 *     while the below-fold JS chunk downloads → renders `<BelowFoldSkeleton/>`.
 *   - `home-below-fold.tsx` — each section's own `isLoading` branch reuses
 *     the matching piece (`TrendingRowSkeleton`),
 *     and the Featured / Near-You grids reuse the same `ActivityCardSkeleton`
 *     grid (`CardGridSkeleton`). So when the chunk's loading skeleton is
 *     replaced by the real component, the skeleton it shows is identical —
 *     no "3 grey boxes flash into 12 differently-shaped ones".
 *
 * Imports `ActivityCardSkeleton` from its file (not the `@/components/ui`
 * barrel) so the loader chunk doesn't drag the whole UI barrel in.
 */

import { ActivityCardSkeleton } from '@/components/ui/activity-card-skeleton';

function HeaderBar({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`jadwal-skeleton rounded-lg h-7 mb-6 md:mb-8 ${wide ? 'w-64 max-w-[80%]' : 'w-48 max-w-[70%]'}`} />
  );
}

/** Mirrors the trending-event card row. */
export function TrendingRowSkeleton() {
  return (
    <div className="flex gap-4 md:gap-5 overflow-hidden pb-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="w-[280px] sm:w-[320px] shrink-0 flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface"
        >
          <div className="h-[200px] jadwal-skeleton" />
          <div className="p-[14px] flex flex-col gap-2">
            <div className="h-4 w-3/4 jadwal-skeleton rounded" />
            <div className="h-3 w-full jadwal-skeleton rounded" />
            <div className="h-3 w-1/2 jadwal-skeleton rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the 3-col activity-card grid used by Featured + Near You. */
export function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <ActivityCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Full below-fold loading layout — used as the lazy-chunk `loading` state. */
export function BelowFoldSkeleton() {
  return (
    <>
      {/* Trending */}
      <section className="bg-jadwal-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <HeaderBar wide />
          <TrendingRowSkeleton />
        </div>
      </section>
      {/* Featured */}
      <section className="bg-jadwal-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <HeaderBar />
          <CardGridSkeleton />
        </div>
      </section>
      {/* Near You */}
      <section className="bg-jadwal-bg-soft">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <HeaderBar wide />
          <CardGridSkeleton />
        </div>
      </section>
      {/* Why AL Jadwal + CTA are static (no queries) — just reserve their height
          with the right backgrounds so the footer doesn't jump when the real
          component mounts and renders them. */}
      <div className="bg-jadwal-surface-muted border-y border-jadwal-border-subtle h-[260px] md:h-[280px]" />
      <div className="bg-linear-to-br from-sky-600 to-indigo-700 h-[300px] md:h-[340px]" />
    </>
  );
}
