'use client';

/**
 * Tiny client wrapper that owns the dynamic import of HomeBelowFold.
 * Next.js requires `dynamic({ ssr: false })` to live inside a client
 * component, so this file exists solely to satisfy that constraint while
 * letting the parent page.tsx remain a server component.
 *
 * The skeleton loading state matches the categories strip footprint so
 * the footer doesn't shift when the chunk hydrates in.
 */

import dynamic from 'next/dynamic';

const HomeBelowFold = dynamic(() => import('../home-below-fold'), {
  ssr: false,
  loading: () => (
    <div className="bg-jadwal-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 md:py-16">
        <div className="h-7 w-56 mb-6 jadwal-skeleton rounded-lg" />
        <div className="flex gap-4 md:gap-6 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shrink-0 w-[88px] flex flex-col items-center gap-2">
              <div className="h-20 w-20 jadwal-skeleton rounded-full" />
              <div className="h-3 w-16 jadwal-skeleton rounded" />
            </div>
          ))}
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="jadwal-skeleton rounded-2xl h-72" />
          ))}
        </div>
      </div>
    </div>
  ),
});

export default function HomeBelowFoldLoader() {
  return <HomeBelowFold />;
}
