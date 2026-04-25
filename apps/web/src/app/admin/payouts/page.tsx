'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminLayout from '../_components/admin-layout';
import PaymentsTab from './_components/payments-tab';
import RequestsTab from './_components/requests-tab';
import { Wallet, Landmark } from 'lucide-react';

/**
 * Unified Payouts admin page. Mirrors the Countries/Cities tab pattern:
 * ONE route, TWO tabs, each tab component mounts lazily so the inactive
 * tab's queries never fire. This matters here because RequestsTab runs
 * 2 queries (list + summary) and PaymentsTab runs 2 more (list + export
 * readiness); fetching all four on every pageload was wasteful.
 *
 * Tab state round-trips via the `?tab=` query param so deep-links and
 * back/forward navigation work. External inbound links (notifications,
 * bookmarks to the old /admin/payout-requests URL) hit this page with
 * the right tab pre-selected because that legacy route redirects here
 * with `?tab=requests`.
 */
type TabKey = 'payments' | 'requests';

const TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'payments', label: 'Payments', icon: Wallet },
  { key: 'requests', label: 'Payout Requests', icon: Landmark },
];

function resolveInitialTab(param: string | null): TabKey {
  return param === 'requests' ? 'requests' : 'payments';
}

export default function AdminPayoutsHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    resolveInitialTab(searchParams.get('tab')),
  );

  // Keep the URL in sync with tab state so the back/forward buttons and
  // external deep-links stay meaningful without triggering a re-mount of
  // the already-mounted tab component.
  useEffect(() => {
    const current = resolveInitialTab(searchParams.get('tab'));
    if (current !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      if (activeTab === 'payments') params.delete('tab');
      else params.set('tab', activeTab);
      const qs = params.toString();
      router.replace(qs ? `/admin/payouts?${qs}` : '/admin/payouts', { scroll: false });
    }
  }, [activeTab, router, searchParams]);

  const handleTabClick = useCallback((key: TabKey) => setActiveTab(key), []);

  // Dynamic header copy so "Payouts" / "Review, approve, complete" stays
  // contextually accurate per tab without adding its own AdminLayout wrapper.
  const { title, subtitle } = activeTab === 'requests'
    ? { title: 'Payouts', subtitle: 'Review, approve, and complete vendor payout requests' }
    : { title: 'Payouts', subtitle: 'View successful payments and manage vendor payouts' };

  return (
    <AdminLayout title={title} subtitle={subtitle}>
      {/* Tab switcher — same pill-group pattern as Countries & Cities */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-slate-800/60 rounded-xl mb-8 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabClick(key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === key
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Conditional render: the inactive tab doesn't mount, so its queries
          never fire. Switching back later causes a fresh mount + fetch. If
          we ever find that expensive (we don't today — both are paginated
          and cached), swap to persistent mount + `enabled` gate. */}
      {activeTab === 'payments' ? <PaymentsTab /> : <RequestsTab />}
    </AdminLayout>
  );
}
