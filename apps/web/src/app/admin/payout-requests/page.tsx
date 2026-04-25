import { redirect } from 'next/navigation';

/**
 * Legacy route — the payout-requests UI is now a tab on /admin/payouts.
 * Kept as a thin redirect so existing notification links and bookmarks
 * (from before the tabs refactor) land on the right tab. Once every
 * emitted notification points at the new URL this file can be removed.
 */
export default function AdminPayoutRequestsLegacyRedirect(): never {
  redirect('/admin/payouts?tab=requests');
}
