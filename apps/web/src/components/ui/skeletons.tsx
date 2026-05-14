import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

interface WrapProps {
  children: React.ReactNode;
  className?: string;
  label?: string;
}

// All composed skeletons wrap their tree in a status region so screen readers
// announce "loading" once instead of every block flashing in.
//
// Height: `min-h-[60vh]` (not `min-h-screen`) so route-level loading.tsx
// slots into the layout's content area without pushing the footer off-screen
// or clipping the navbar. Matches RouteSpinner. Pages that need a full
// viewport (login/register landing pages) pass `min-h-screen` via className.
function SkeletonPage({ children, className, label = 'Loading' }: WrapProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn('min-h-[60vh]', className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function ActivityGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonPage className="bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" label="Loading activities">
      <div className="max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50 overflow-hidden"
            >
              <Skeleton className="h-48 w-full rounded-none" />
              <div className="p-5 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

export function ActivityDetailSkeleton() {
  return (
    <SkeletonPage className="bg-gray-50 dark:bg-slate-950" label="Loading activity">
      <Skeleton className="h-[60vh] w-full rounded-none" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 relative">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 shadow-xl">
          <Skeleton className="h-9 w-2/3 mb-3" />
          <Skeleton className="h-5 w-1/2 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-9/12" />
              <div className="pt-6 space-y-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 dark:border-slate-800 p-5 space-y-3">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonPage className="bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" label="Loading">
      <div className="max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-80 mb-8" />
        <div className="space-y-4">
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50 p-5 flex gap-4"
            >
              <Skeleton className="h-24 w-32 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

export function FormSkeleton() {
  return (
    <SkeletonPage
      // Login / register / password flows own their full viewport, so keep
      // `min-h-screen` here to match the real page's design.
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-gray-50 dark:bg-slate-950"
      label="Loading form"
    >
      <div className="w-full max-w-md space-y-5 bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 shadow-xl border border-gray-200/80 dark:border-slate-800/60">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-4 w-40 mx-auto" />
      </div>
    </SkeletonPage>
  );
}

export function SettingsSkeleton() {
  return (
    <SkeletonPage className="bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" label="Loading settings">
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 p-6 space-y-5">
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 p-6 space-y-5">
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </SkeletonPage>
  );
}

// Sidebar + main-content shell used by admin and vendor pages.
export function SidebarPageSkeleton() {
  return (
    <SkeletonPage className="bg-gray-50 dark:bg-slate-950" label="Loading">
      <div className="flex">
        <aside className="hidden md:block w-64 shrink-0 min-h-screen border-e border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900 p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <div className="pt-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex-1 p-6 lg:p-10">
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-4 w-96 mb-8" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900 p-5 space-y-3"
              >
                <Skeleton className="h-10 w-10" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-slate-800">
              <Skeleton className="h-6 w-48" />
            </div>
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
        </main>
      </div>
    </SkeletonPage>
  );
}

// Shape-matching skeleton for `/profile`. Mirrors the heading area and
// the inline `ProfileSkeleton` used inside page.tsx — 1 header card,
// 4 stat tiles, 1 content card — so the cold-load transition into the
// real page is shape-stable.
//
// Navbar is intentionally NOT rendered here (matches the
// `ActivityGridSkeleton` / route-level pattern). The brief moment between
// `loading.tsx` and the hydrated page rendering its own navbar is
// acceptable; the alternative (rendering navbar in loading.tsx) double-
// mounts a heavy client component during navigation.
export function ProfilePageSkeleton() {
  return (
    <SkeletonPage
      className="bg-jadwal-bg px-4 sm:px-6 pt-24 pb-16"
      label="Loading profile"
    >
      <div className="max-w-4xl mx-auto">
        {/* Heading area — h1 + subtitle. */}
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 md:h-10 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="space-y-6">
          {/* Header card */}
          <Skeleton className="h-28 rounded-2xl" />
          {/* 4-stat grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          {/* Content card */}
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    </SkeletonPage>
  );
}

// Shape-matching skeleton for `/bookings/[id]`. Mirrors the inline
// `BookingDetailSkeleton` used inside page.tsx — a back-link + 4
// stacked content blocks (header, body, breakdown, actions). The page
// itself already does the shell-unconditional + inline skeleton pattern
// for its `useQuery` state — this only sharpens the cold-navigation
// flash from a generic spinner to a shape preview.
export function BookingDetailPageSkeleton() {
  return (
    <SkeletonPage
      className="bg-jadwal-bg px-4 sm:px-6 pt-24 pb-16"
      label="Loading booking"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </SkeletonPage>
  );
}

// Shape-matching skeleton for `/activity/[slug]`. Renders the
// content-area only (no navbar) so it can be composed two ways:
//   1) loading.tsx renders it directly (route boundary, before page chunk loads)
//   2) page.tsx's early-return wraps it with <Navbar /> (during the
//      query phase after hydration)
// Same component in both places = continuous shape across the
// navigation→hydration transition, no visible "spinner-to-skeleton" jump.
export function ActivityDetailPageSkeleton() {
  return (
    <SkeletonPage className="bg-jadwal-bg" label="Loading activity">
      <div className="pt-24 max-w-7xl mx-auto px-4 sm:px-6">
        <Skeleton className="h-6 w-40 mb-6 rounded" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-80 md:h-[450px] rounded-[20px]" />
            <Skeleton className="h-6 w-3/4 rounded" />
            <Skeleton className="h-4 w-1/2 rounded" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
          <Skeleton className="h-96 rounded-[20px]" />
        </div>
      </div>
    </SkeletonPage>
  );
}

// Minimal page loader for simple / legal / callback routes.
export function PageShellSkeleton() {
  return (
    <SkeletonPage
      className="flex items-center justify-center p-8 bg-gray-50 dark:bg-slate-950"
      label="Loading"
    >
      <div className="w-full max-w-3xl space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-10/12" />
        <Skeleton className="h-5 w-9/12" />
      </div>
    </SkeletonPage>
  );
}
