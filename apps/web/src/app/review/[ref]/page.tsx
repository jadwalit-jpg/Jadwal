'use client';

/**
 * /review/<booking reference> — the one stable link that opens the review
 * form for a booking (sent in the review-ask email and by the WhatsApp
 * inbox agent; Arabic under /ar/review/<ref>). Requires sign-in: a visitor is
 * sent to login and comes back here. Uses the existing review endpoint and
 * rules (rating only, one review per customer per activity, active listing).
 */
import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, Star } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { localized } from '@/lib/localize';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { Button } from '@/components/ui';
import { ReviewStars } from '@/components/review-stars';
import type { ReviewPromptData } from '@/components/review-prompt';

interface ByRefResponse {
  prompt: ReviewPromptData;
  alreadyReviewed: boolean;
  canReview: boolean;
}

export default function ReviewByRefPage() {
  const { t } = useTranslation();
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [done, setDone] = useState(false);

  // Sign-in required: send the visitor to login and bring them back here.
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  const isCustomer = !!user && user.role === 'CUSTOMER';
  const { data, isLoading, error } = useQuery<ByRefResponse>({
    queryKey: ['review-by-ref', ref, user?.id ?? null],
    queryFn: async () => (await api.get(`/customer/review-prompts/by-ref/${encodeURIComponent(ref)}`)).data,
    enabled: isCustomer && !!ref,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => (await api.post('/customer/reviews', { activityId: data!.prompt.activity.id, rating })).data,
    onSuccess: () => {
      toast(t('activity.toast.reviewSubmitted', { defaultValue: 'Review submitted!' }));
      setDone(true);
    },
    onError: (err) => toast(getApiError(err, t('reviewAsk.submitFailed', { defaultValue: 'Could not submit your rating' })), 'error'),
  });
  const never = useMutation({
    mutationFn: async () => (await api.post(`/customer/review-prompts/${data!.prompt.bookingId}/dismiss`, { mode: 'never' })).data,
    onSuccess: () => toast(t('reviewAsk.neverDone', { defaultValue: 'We will not ask again for this booking.' })),
  });

  const notFound = !!error && (error as { response?: { status?: number } })?.response?.status === 404;
  const activityTitle = data ? localized(data.prompt.activity, 'title') : '';
  const listingHref = data ? `/activity/${data.prompt.activity.slug}` : '/explore';

  return (
    <div className="min-h-screen flex flex-col bg-jadwal-bg">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-lg px-4 py-10">
        <h1 className="font-display text-2xl font-semibold text-jadwal-text mb-6">
          {t('reviewAsk.pageTitle', { defaultValue: 'Rate your experience' })}
        </h1>

        {loading || !user ? (
          <p className="text-sm text-jadwal-text-muted">{t('common.loading', { defaultValue: 'Loading…' })}</p>
        ) : !isCustomer ? (
          <p className="text-sm text-jadwal-text-muted" data-testid="review-not-customer">
            {t('reviewAsk.customersOnly', { defaultValue: 'Only customers can rate an activity.' })}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-jadwal-text-muted">{t('common.loading', { defaultValue: 'Loading…' })}</p>
        ) : notFound || !data ? (
          <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-6" data-testid="review-not-found">
            <p className="text-sm text-jadwal-text">{t('reviewAsk.notFound', { defaultValue: 'We could not find this booking in your account.' })}</p>
            <Button className="mt-4" onClick={() => router.push('/bookings')}>{t('booking.backToBookings', { defaultValue: 'Back to my bookings' })}</Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface overflow-hidden" data-testid="review-form-card">
            {data.prompt.activity.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.prompt.activity.coverImage} alt="" className="h-44 w-full object-cover" />
            ) : null}
            <div className="p-6">
              <p className="text-[11px] uppercase tracking-[0.4px] text-jadwal-text-muted">{data.prompt.bookingRef}</p>
              <h2 className="mt-1 text-xl font-semibold text-jadwal-text">{activityTitle}</h2>

              {done || data.alreadyReviewed ? (
                <div className="mt-5 flex items-start gap-3" data-testid="review-thanks">
                  <CheckCircle className="h-6 w-6 text-jadwal-success shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-jadwal-text">{t('reviewAsk.thanksTitle', { defaultValue: 'Thank you!' })}</p>
                    <p className="mt-1 text-sm text-jadwal-text-muted">
                      {done
                        ? t('reviewAsk.thanksBody', { defaultValue: 'Your rating helps other customers and the organiser.' })
                        : t('reviewAsk.alreadyReviewed', { defaultValue: 'You already rated this activity. Thank you!' })}
                    </p>
                    <Button className="mt-4" onClick={() => router.push(listingHref)}>{t('reviewAsk.viewListing', { defaultValue: 'View the activity' })}</Button>
                  </div>
                </div>
              ) : !data.canReview ? (
                <p className="mt-5 text-sm text-jadwal-text-muted" data-testid="review-not-available">
                  {t('reviewAsk.notAvailable', { defaultValue: 'This booking cannot be rated.' })}
                </p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-jadwal-text-muted inline-flex items-center gap-1.5">
                    <Star className="h-4 w-4 text-jadwal-accent" aria-hidden="true" />
                    {t('reviewAsk.promptSubtitle', { defaultValue: 'Tap a star to rate it. It takes a few seconds.' })}
                  </p>
                  <div className="mt-4">
                    <ReviewStars value={rating} onChange={setRating} disabled={submit.isPending} idPrefix="review-page-star" />
                  </div>
                  <div className="mt-6 flex flex-col gap-2">
                    <Button full size="lg" onClick={() => submit.mutate()} disabled={rating === 0 || submit.isPending} loading={submit.isPending}>
                      {t('reviewAsk.submit', { defaultValue: 'Submit rating' })}
                    </Button>
                    <button
                      type="button"
                      onClick={() => never.mutate()}
                      disabled={never.isPending}
                      data-testid="review-page-never"
                      className="min-h-11 text-sm text-jadwal-text-muted hover:text-jadwal-text"
                    >
                      {t('reviewAsk.never', { defaultValue: "Don't ask again for this booking" })}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
