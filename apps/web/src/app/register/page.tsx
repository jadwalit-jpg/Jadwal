/**
 * /register — server-rendered shell. Same pattern as /login: paint the
 * background image (LCP element) from the first byte of HTML so it's not
 * blocked on the provider chain. RegisterForm is the client island.
 *
 * 2026-04-26: split out of the previous all-client register/page.tsx.
 */

import RegisterForm from './register-form';

export default function RegisterPage() {
  return (
    <div className="relative h-svh font-outfit overflow-hidden">
      {/* Full-screen background — LCP element. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105"
        style={{ backgroundImage: "url('/images/login-bg.webp')" }}
      />
      {/* Dark overlay — /40 (was /25) for legible white text over the bright
          hero on mobile (glass card has no backdrop-blur there). */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Scroll layer: the register card is tall (5 inputs + strength meter +
          consent). Centered when it fits, scrolls without clipping when it
          doesn't — fixes the previous bottom cut-off on short screens. */}
      <div className="relative z-10 h-svh overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-6">
          <div className="glass-surface w-full max-w-sm p-8">
            <div className="absolute -top-20 -inset-e-20 w-40 h-40 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -inset-s-20 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
              <RegisterForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
