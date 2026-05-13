/**
 * Route-level skeleton for /notifications. Matches the page's max-width and
 * top-padding so there's no layout shift when the real page mounts.
 */

import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <div className="h-16" />
      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <Skeleton className="h-8 w-48 mb-6" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle">
                <Skeleton className="w-2.5 h-2.5 rounded-full mt-2 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
