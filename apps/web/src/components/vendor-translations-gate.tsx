'use client';

/**
 * Loads the `vendor.*` translations, which are NOT in the main locale bundle.
 *
 * WHY THEY ARE SPLIT OUT. The vendor section is the single largest thing in the
 * locale files — 35 KB of en.json and 44 KB of ar.json, ~43% of the total — and
 * it was shipped to every visitor on every page. A customer browsing activities
 * downloaded and parsed the entire vendor dashboard vocabulary they will never
 * see. JavaScript parse time is the bottleneck on the mobile performance score
 * (LCP and CLS are already good), so 79 KB of dead weight is worth removing.
 *
 * Verified before splitting: the only components that use `vendor.*` keys —
 * activity-blocks-manager, activity-blocks-summary and
 * activity-special-prices-manager — are imported ONLY by /vendor/* and
 * /admin/* routes. No customer-facing page references them.
 *
 * WHY A RUNTIME MERGE RATHER THAN AN i18next NAMESPACE. Every call site uses
 * `t('vendor.xxx')`. Registering a real namespace would make those `t('vendor:xxx')`
 * and require touching 60+ call sites — a large, risky rename for no benefit.
 * `addResourceBundle` merges the section back into the SAME default namespace,
 * so every existing key keeps working untouched.
 *
 * WHY IT GATES RENDERING. Without the bundle, `t('vendor.foo')` returns the raw
 * key, so children would paint "vendor.dashboard.title" for a frame. These are
 * authenticated dashboards that already show loading states for their data, and
 * they are noindex, so a brief spinner costs nothing. Customer pages never
 * render this component at all.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';

/** Languages whose vendor bundle has already been merged, per page load. */
const loaded = new Set<string>();

async function loadVendorBundle(lng: string): Promise<void> {
  if (loaded.has(lng)) return;
  const mod =
    lng === 'ar'
      ? await import('@/locales/ar.vendor.json')
      : await import('@/locales/en.vendor.json');
  // deep = true, overwrite = true — merge under the existing `translation`
  // namespace so `t('vendor.xxx')` resolves exactly as it did before the split.
  i18n.addResourceBundle(lng, 'translation', { vendor: mod.default }, true, true);
  loaded.add(lng);
}

export default function VendorTranslationsGate({ children }: { children: React.ReactNode }) {
  const { i18n: inst } = useTranslation();
  const lng = inst.language === 'ar' ? 'ar' : 'en';
  // Start ready when this language was already merged (client-side navigation
  // between vendor pages, or a language the user has visited before) so those
  // navigations never flash a spinner.
  const [ready, setReady] = useState(() => loaded.has(lng));

  useEffect(() => {
    let cancelled = false;
    if (loaded.has(lng)) {
      setReady(true);
      return;
    }
    setReady(false);
    loadVendorBundle(lng)
      .catch(() => {
        // A failed chunk fetch must not leave a permanently blank dashboard.
        // Render children anyway: keys degrade to their raw form, which is ugly
        // but usable, and far better than an empty page.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lng]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
