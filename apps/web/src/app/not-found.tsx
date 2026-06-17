import type { Metadata } from 'next';
import Link from 'next/link';

// 404s must never be indexed. This also covers the "soft 404" case: a streamed
// dynamic route (/[landingSlug], /blog/[slug]) that calls notFound() can only
// return HTTP 200 + this UI (the response has already started), so noindex
// guarantees that even a crawled unknown slug can't be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200 dark:text-slate-800">404</h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-slate-400">Page not found</p>
        <Link
          href="/"
          className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
