'use client';

/**
 * Tiny client wrapper that owns the dynamic import of HomeBelowFold.
 * Next.js requires `dynamic({ ssr: false })` to live inside a client
 * component, so this file exists solely to satisfy that constraint while
 * letting the parent page.tsx remain a server component.
 *
 * The `loading` state is `<BelowFoldSkeleton/>` — the *same* skeleton the
 * mounted component shows while its queries load (see below-fold-skeleton.tsx)
 * — so when the chunk finishes downloading and the real component takes over,
 * the skeleton doesn't visibly change shape. It also reserves roughly the
 * full below-fold height, so the footer doesn't jump.
 */

import dynamic from 'next/dynamic';
import { BelowFoldSkeleton } from './below-fold-skeleton';

const HomeBelowFold = dynamic(() => import('../home-below-fold'), {
  ssr: false,
  loading: () => <BelowFoldSkeleton />,
});

export default function HomeBelowFoldLoader() {
  return <HomeBelowFold />;
}
