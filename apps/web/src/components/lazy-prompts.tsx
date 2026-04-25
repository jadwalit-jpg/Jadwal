/**
 * Lazy wrapper for the two below-the-fold prompts that mount via the root
 * layout (PhonePrompt + PushPrompt). The root layout is a Server Component
 * (it reads cookies via `headers()`) so it can't use `dynamic({ ssr: false })`
 * directly — that option is only allowed inside Client Components. This
 * 'use client' wrapper hosts the dynamic imports.
 *
 * UI behavior is identical: both prompts render conditionally based on user
 * state anyway (phone-not-verified / push-not-subscribed), so SSR'ing them
 * as null and hydrating them post-mount is the same end-user experience —
 * just with the JS bundle deferred off the LCP path on every route.
 */
'use client';

import dynamic from 'next/dynamic';

const PhonePrompt = dynamic(
  () => import('@/components/phone-prompt').then((m) => m.PhonePrompt),
  { ssr: false },
);
const PushPrompt = dynamic(
  () => import('@/components/push-prompt').then((m) => m.PushPrompt),
  { ssr: false },
);

export function LazyPrompts() {
  return (
    <>
      <PhonePrompt />
      <PushPrompt />
    </>
  );
}
