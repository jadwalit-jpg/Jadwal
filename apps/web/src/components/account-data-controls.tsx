'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import api from '@/lib/api';

/**
 * W.127 customer self-service block — sits at the bottom of /profile.
 *
 * Two affordances:
 *   1. "Download my data" → GET /auth/account/export → browser downloads
 *      a JSON file with everything Jadwal stores about the user. Backend
 *      enforces 24h cooldown per user; this UI shows a toast on cooldown
 *      hits and a generic error otherwise.
 *   2. "Delete my account" → opens a confirmation modal that asks the
 *      user to type the literal phrase "DELETE" (case-insensitive,
 *      trimmed). Same UX as GitHub / AWS / Vercel destructive deletion.
 *      Forces a deliberate action and stops accidental double-clicks.
 *      Submit button is disabled until the typed phrase matches. On
 *      success the user is logged out + booted to the public root.
 *
 * Both calls share the existing api axios client (already wired for
 * cookies + CSRF-safe SameSite=Strict). No extra dep needed.
 */
export function AccountDataControls() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { logout } = useAuth();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Strict literal match against "DELETE" (case-insensitive, trimmed) —
  // mirrors the server-side check. Disables the destructive button until
  // the user has typed the exact phrase.
  const CONFIRM_PHRASE = 'DELETE';
  const confirmationMatches = confirmation.trim().toUpperCase() === CONFIRM_PHRASE;

  async function handleDownload() {
    setDownloading(true);
    try {
      // `responseType: 'blob'` so axios doesn't try to parse the response
      // as JSON when we want to hand the raw bytes straight to a Blob URL.
      const res = await api.get('/auth/account/export', { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `jadwal-account-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the click handler so the browser has time to grab
      // the bytes. setTimeout 0 is enough on every major engine.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      toast(
        t('account.exportSuccess', { defaultValue: 'Your data export was downloaded.' }),
        'success',
      );
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message =
        status === 429
          ? t('account.exportCooldown', {
              defaultValue: 'You can request a data export once every 24 hours.',
            })
          : t('account.exportFailed', { defaultValue: 'Could not export your data. Please try again.' });
      toast(message, 'error');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!confirmationMatches) {
      toast(
        t('account.deleteConfirmationRequired', {
          defaultValue: `Type ${CONFIRM_PHRASE} to confirm.`,
        }),
        'error',
      );
      return;
    }
    setDeleting(true);
    try {
      await api.delete('/auth/account', { data: { confirmation } });
      // Server clears cookies; refresh local auth state then route to /.
      await logout().catch(() => undefined);
      toast(
        t('account.deleteSuccess', { defaultValue: 'Your account has been deleted.' }),
        'success',
      );
      router.replace('/');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      let message: string;
      if (status === 400) {
        message = t('account.deleteWrongConfirmation', {
          defaultValue: `Type ${CONFIRM_PHRASE} to confirm.`,
        });
      } else if (status === 403) {
        message = t('account.deleteForbidden', {
          defaultValue: 'Vendor accounts cannot be self-deleted. Contact support.',
        });
      } else if (status === 429) {
        message = t('account.deleteCooldown', {
          defaultValue: 'Too many attempts. Please wait and try again.',
        });
      } else {
        message = t('account.deleteFailed', { defaultValue: 'Could not delete your account.' });
      }
      toast(message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-red-200/60 dark:border-red-900/40 bg-white dark:bg-jadwal-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-red-200/40 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/20">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
          {t('account.dangerZone', { defaultValue: 'Account data & deletion' })}
        </h2>
        <p className="text-xs text-jadwal-text-muted mt-1">
          {t('account.dangerZoneNote', {
            defaultValue: 'Download a copy of your data or permanently delete your account.',
          })}
        </p>
      </div>

      <div className="divide-y divide-jadwal-border-subtle">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="w-full flex items-center gap-3.5 px-5 py-4 hover:bg-jadwal-surface-muted transition-colors text-left disabled:opacity-60"
        >
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <Download className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-jadwal-text">
              {t('account.exportButton', { defaultValue: 'Download my data' })}
            </div>
            <div className="text-xs text-jadwal-text-muted mt-0.5">
              {t('account.exportNote', {
                defaultValue: 'JSON export of your profile, bookings, reviews, and history.',
              })}
            </div>
          </div>
          {downloading ? (
            <span className="text-xs font-medium text-jadwal-text-muted">…</span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="w-full flex items-center gap-3.5 px-5 py-4 hover:bg-red-50/60 dark:hover:bg-red-950/20 transition-colors text-left"
        >
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-700 dark:text-red-300">
              {t('account.deleteButton', { defaultValue: 'Delete my account' })}
            </div>
            <div className="text-xs text-jadwal-text-muted mt-0.5">
              {t('account.deleteNote', {
                defaultValue:
                  'Permanent. Bookings and payments are kept for legal records but your profile is anonymised.',
              })}
            </div>
          </div>
        </button>
      </div>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-jadwal-surface shadow-xl overflow-hidden">
            <div className="flex items-start justify-between px-5 pt-5 pb-3">
              <div>
                <h3 id="delete-account-title" className="text-lg font-bold text-jadwal-text">
                  {t('account.confirmDeleteTitle', { defaultValue: 'Delete your account?' })}
                </h3>
                <p className="text-sm text-jadwal-text-muted mt-1">
                  {t('account.confirmDeleteBody', {
                    defaultValue:
                      'Your profile will be anonymised and you will be signed out. Bookings and payments are preserved for legal retention but no longer linked to a recognisable account.',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmation('');
                }}
                className="rounded-full p-1 text-jadwal-text-muted hover:bg-jadwal-surface-muted transition-colors"
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 pb-5">
              <label
                htmlFor="delete-account-confirmation"
                className="block text-xs font-medium text-jadwal-text-muted mb-1.5"
              >
                {t('account.confirmPhraseLabel', {
                  defaultValue: 'Type DELETE to confirm',
                })}
              </label>
              <input
                id="delete-account-confirmation"
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={50}
                placeholder={CONFIRM_PHRASE}
                aria-invalid={confirmation.length > 0 && !confirmationMatches}
                className="w-full rounded-xl border border-jadwal-border-subtle bg-white dark:bg-jadwal-surface-raised px-3.5 py-2.5 text-sm font-mono tracking-wider text-jadwal-text focus:outline-none focus:ring-2 focus:ring-red-500/40"
              />

              <div className="flex flex-col sm:flex-row gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    setConfirmation('');
                  }}
                  className="px-5 py-2.5 rounded-xl border border-jadwal-border-strong hover:bg-jadwal-surface-muted text-jadwal-text text-sm font-semibold transition-colors"
                >
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || !confirmationMatches}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deleting
                    ? t('account.deleting', { defaultValue: 'Deleting…' })
                    : t('account.confirmDeleteAction', { defaultValue: 'Delete permanently' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
