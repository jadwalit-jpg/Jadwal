'use client';

/**
 * Installs the Facebook in-app-browser error guard (see lib/in-app-browser-guard.ts).
 *
 * The install runs at MODULE LOAD on the client — when this chunk is evaluated
 * during hydration — so it is in place before any analytics tag is injected
 * (those load from effects, after consent). Renders nothing.
 */

import { installInAppBrowserGuard } from '@/lib/in-app-browser-guard';

if (typeof window !== 'undefined') installInAppBrowserGuard(window);

export function InAppBrowserGuard() {
  return null;
}
