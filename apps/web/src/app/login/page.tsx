/**
 * /login — server-rendered shell. The full-screen background image is the
 * LCP element on this route; rendering it as static HTML lets the browser
 * paint it from the first byte of the response instead of waiting on the
 * provider chain (QueryProvider → I18nProvider → AuthProvider →
 * ToastProvider) to hydrate. The LoginForm child is a client island that
 * owns all interactive state.
 *
 * 2026-04-26: split out of the previous all-client login/page.tsx.
 */

import LoginForm from './login-form';

export default function LoginPage() {
  return (
    <div className="relative min-h-svh font-outfit overflow-hidden">
      {/* Full-screen background image — LCP element. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105"
        style={{ backgroundImage: "url('/images/login-bg.webp')" }}
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/25" />

      {/* Centered glass card */}
      <div className="relative z-10 flex min-h-svh items-center justify-center p-6">
        <div className="glass-surface w-full max-w-sm p-8">
          {/* Inner color accents */}
          <div className="absolute -top-20 -inset-e-20 w-40 h-40 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -inset-s-20 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Content */}
          <div className="relative z-10">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
