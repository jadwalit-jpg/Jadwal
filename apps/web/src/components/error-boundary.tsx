'use client';

import { Component, type ReactNode } from 'react';

/**
 * Root-level React error boundary.
 *
 * Why class component: as of React 19, error boundaries can ONLY be implemented
 * via class components (`componentDidCatch` + `getDerivedStateFromError`). No
 * hook equivalent in core React.
 *
 * What it catches: render-time errors thrown inside any descendant React tree.
 * Does NOT catch:
 *   - Errors in event handlers (those bubble to window.onerror)
 *   - Errors in async code outside the render commit (await / setTimeout /
 *     queryFn) — those need try/catch or TanStack Query's `onError`
 *   - Errors during SSR (Next.js's `error.tsx` route segment is the matching
 *     boundary on the server side)
 *
 * Reporting pipeline:
 *   browser componentDidCatch → POST /api/log/client-error → NestJS Logger
 *   → ECS stdout → CloudWatch /ecs/jadwal-api → CloudWatch Insights query
 * The dev-only `console.error` is a fallback so devtools also surface the
 * stack on local; production logs land in CloudWatch.
 *
 * The fetch is best-effort: a failure to report doesn't block the fallback
 * UI from rendering, and we deliberately don't await it inside componentDidCatch
 * (which is sync). `keepalive: true` lets the request survive a navigation
 * away from the broken page — important when the user clicks Reload while
 * the report is in flight.
 */
function reportError(payload: {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userAgent?: string;
}) {
  if (typeof window === 'undefined') return;

  // In dev, also surface the stack in DevTools so the workflow stays familiar.
  // Allowlist the explicit dev value rather than `!== 'production'` —
  // matches the pattern enforced by the security-scan CI rule (any
  // `if (NODE_ENV !== 'production')` accidentally enables dev behaviour
  // in non-prod-non-dev envs like `staging` or `test`).
  if (process.env.NODE_ENV === 'development') {
    console.error('[ErrorBoundary]', payload.message, '\n', payload.stack);
  }

  // The /api proxy on the web app forwards to the NestJS API. Using the
  // proxy keeps this same-origin (no CORS preflight on the error path) and
  // means we don't have to read NEXT_PUBLIC_API_URL from inside a class
  // component. `keepalive` so the request can outlive a Reload click.
  try {
    fetch('/api/log/client-error', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: payload.message.slice(0, 1000),
        stack: payload.stack?.slice(0, 8000),
        componentStack: payload.componentStack?.slice(0, 4000),
        url: payload.url?.slice(0, 2000),
        userAgent: payload.userAgent?.slice(0, 500),
      }),
    }).catch(() => {
      // Swallow — the fallback UI is what the user sees regardless of
      // whether logging worked. A retry loop here could thrash a user
      // already in a bad state. Rate-limit + monitoring on the API side
      // is the place to detect a logging outage.
    });
  } catch {
    // Some browsers throw synchronously on misconfigured fetch (Safari
    // strict CSP edge cases). Same swallow rationale as above.
  }
}

interface State {
  hasError: boolean;
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    // Strip query string client-side too — defense in depth alongside the
    // server-side stripping in /api/log/client-error. An OAuth error landing
    // on the boundary mid-redirect carries the auth code in the query; a
    // misconfigured cache layer between client + API could observe the raw
    // payload before sanitisation runs server-side.
    let cleanUrl: string | undefined;
    if (typeof window !== 'undefined') {
      try {
        const u = new URL(window.location.href);
        cleanUrl = `${u.origin}${u.pathname}`;
      } catch {
        cleanUrl = undefined;
      }
    }

    reportError({
      message: error.message || 'Unknown render error',
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
      url: cleanUrl,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="min-h-screen flex items-center justify-center bg-jadwal-bg px-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8 text-red-600 dark:text-red-400"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-jadwal-text">Something went wrong</h1>
            <p className="text-sm text-jadwal-text-muted leading-relaxed">
              We hit an unexpected error and have logged it for review. You can try again
              or reload the page.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl border border-jadwal-border-strong hover:bg-jadwal-surface-muted text-jadwal-text text-sm font-semibold transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
