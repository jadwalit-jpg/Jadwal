/**
 * Lazy wrapper for the below-the-fold PushPrompt that mounts via the root
 * layout. The root layout is a Server Component (it reads cookies via
 * `headers()`) so it can't use `dynamic({ ssr: false })` directly — that
 * option is only allowed inside Client Components. This 'use client'
 * wrapper hosts the dynamic import.
 *
 * UI behavior is identical to direct import: the prompt renders
 * conditionally based on user state (push-not-subscribed) anyway, so
 * SSR'ing it as null and hydrating post-mount is the same end-user
 * experience — just with the JS bundle deferred off the LCP path on
 * every route.
 *
 * The PhonePrompt auto-popup was removed (PR #184) — phone verification
 * is now only triggered explicitly from /profile and the booking flow,
 * not as a 1.5s delayed nag on every authenticated customer route.
 */
'use client';

import dynamic from 'next/dynamic';

const PushPrompt = dynamic(
  () => import('@/components/push-prompt').then((m) => m.PushPrompt),
  { ssr: false },
);

export function LazyPrompts() {
  return <PushPrompt />;
}
