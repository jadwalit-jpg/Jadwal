import { Skeleton } from './skeleton';

/**
 * Loading placeholder shaped like `<ActivityCard size="fill">` — image block
 * on top, a few text bars below. Rendering a grid of these while the data is
 * in flight (instead of a short empty/“detecting…” box) keeps the section's
 * height roughly constant, so the real cards swap in without a layout shift
 * (fixes the homepage CLS on the "Near You" / "Featured" sections). `aria-hidden`
 * — the section already announces "loading" via its own status region.
 */
export function ActivityCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal"
    >
      {/* Mirrors ActivityCard's `sz.img` for size="fill" (h-[200px], w-full). */}
      <Skeleton className="h-[200px] w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-1.5 p-[14px]">
        <Skeleton className="h-3 w-24" />        {/* city · duration meta row */}
        <Skeleton className="h-4 w-full" />      {/* title line 1 */}
        <Skeleton className="h-4 w-2/3" />       {/* title line 2 */}
        <Skeleton className="h-3 w-1/2" />       {/* vendor */}
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="flex items-end justify-between gap-2">
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-8" />  {/* "from" label */}
              <Skeleton className="h-5 w-20" />   {/* price */}
            </div>
            <Skeleton className="h-4 w-16" />     {/* rating */}
          </div>
          <Skeleton className="h-8 w-full rounded-xl" />  {/* View button */}
        </div>
      </div>
    </article>
  );
}
