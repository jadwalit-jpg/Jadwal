'use client';

/**
 * Review ask pop-up. When a signed-in customer has an open review ask (the
 * API's "next" prompt), a dialog shows the activity's photo and name, five
 * stars and Submit, plus "Later" (hidden until the next ask) and "Don't ask
 * again for this booking". It never shows on the booking, payment, auth,
 * review, admin or vendor pages, and it follows the server's two-ask rule:
 * the API decides whether there is anything to show.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { localized } from '@/lib/localize';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import { ReviewStars } from '@/components/review-stars';

export interface ReviewPromptData {
  bookingId: string;
  bookingRef: string;
  endDate: string;
  activity: { id: string; titleEn: string; titleAr: string; slug: string; coverImage: string | null };
}

const EXCLUDED_PATHS: RegExp[] = [
  /^\/activity\/[^/]+\/book(\/|$)/,
  /^\/bookings(\/|$)/,
  /^\/payment(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/forgot-password(\/|$)/,
  /^\/reset-password(\/|$)/,
  /^\/verify-email(\/|$)/,
  /^\/review(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/vendor(\/|$)/,
];

/** Where the pop-up may appear: not while booking, paying, signing in or reviewing. */
export function reviewPromptAllowedOn(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname === '/ar' ? '/' : pathname.startsWith('/ar/') ? pathname.slice(3) : pathname;
  return !EXCLUDED_PATHS.some((re) => re.test(p));
}

/** Delay before the dialog appears, so it never pops over the page load. */
export const SHOW_AFTER_MS = 1500;

export function ReviewPrompt({ delayMs = SHOW_AFTER_MS }: { delayMs?: number } = {}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const allowed = !!user && user.role === 'CUSTOMER' && reviewPromptAllowedOn(pathname);

  const { data: prompt } = useQuery<ReviewPromptData | null>({
    queryKey: ['review-prompt', user?.id ?? null],
    queryFn: async () => (await api.get('/customer/review-prompts/next')).data?.prompt ?? null,
    enabled: allowed,
    staleTime: 5 * 60_000,
  });

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [handledBookingId, setHandledBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (!prompt || !allowed || handledBookingId === prompt.bookingId) return;
    const timer = setTimeout(() => setOpen(true), delayMs);
    return () => clearTimeout(timer);
  }, [prompt, allowed, handledBookingId, delayMs]);

  const close = () => {
    setOpen(false);
    setRating(0);
    if (prompt) setHandledBookingId(prompt.bookingId);
    queryClient.invalidateQueries({ queryKey: ['review-prompt'] });
  };

  const submit = useMutation({
    mutationFn: async () => (await api.post('/customer/reviews', { activityId: prompt!.activity.id, rating })).data,
    onSuccess: () => {
      toast(t('activity.toast.reviewSubmitted', { defaultValue: 'Review submitted!' }));
      queryClient.invalidateQueries({ queryKey: ['activity', prompt?.activity.slug] });
      close();
    },
    onError: (err) => toast(getApiError(err, t('reviewAsk.submitFailed', { defaultValue: 'Could not submit your rating' })), 'error'),
  });
  const dismiss = useMutation({
    mutationFn: async (mode: 'later' | 'never') => (await api.post(`/customer/review-prompts/${prompt!.bookingId}/dismiss`, { mode })).data,
    onSettled: () => close(),
  });

  if (!open || !prompt || !allowed) return null;
  const title = localized(prompt.activity, 'title');
  const busy = submit.isPending || dismiss.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-prompt-title"
        data-testid="review-prompt"
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) dismiss.mutate('later'); }}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-200 dark:border-slate-800 overflow-hidden"
      >
        {prompt.activity.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={prompt.activity.coverImage} alt="" className="h-36 w-full object-cover" />
        ) : null}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="review-prompt-title" className="text-lg font-bold text-gray-900 dark:text-white">
                {t('reviewAsk.promptTitle', { activity: title, defaultValue: 'How was {{activity}}?' })}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {t('reviewAsk.promptSubtitle', { defaultValue: 'Tap a star to rate it. It takes a few seconds.' })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate('later')}
              disabled={busy}
              aria-label={t('reviewAsk.later', { defaultValue: 'Later' })}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 flex justify-center">
            <ReviewStars value={rating} onChange={setRating} disabled={busy} idPrefix="review-prompt-star" />
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => submit.mutate()}
              disabled={busy || rating === 0}
              data-testid="review-prompt-submit"
              className="min-h-11 rounded-xl bg-jadwal-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submit.isPending ? t('common.submitting', { defaultValue: 'Submitting…' }) : t('reviewAsk.submit', { defaultValue: 'Submit rating' })}
            </button>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => dismiss.mutate('later')}
                disabled={busy}
                data-testid="review-prompt-later"
                className="min-h-11 flex-1 rounded-xl border border-gray-200 dark:border-slate-700 px-4 text-sm font-medium text-gray-700 dark:text-slate-200 disabled:opacity-50"
              >
                {t('reviewAsk.later', { defaultValue: 'Later' })}
              </button>
              <button
                type="button"
                onClick={() => dismiss.mutate('never')}
                disabled={busy}
                data-testid="review-prompt-never"
                className="min-h-11 flex-1 rounded-xl px-4 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 disabled:opacity-50"
              >
                {t('reviewAsk.never', { defaultValue: "Don't ask again for this booking" })}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
