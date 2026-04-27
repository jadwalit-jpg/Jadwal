import Link from 'next/link';

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
