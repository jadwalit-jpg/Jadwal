'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, Gift, Tag } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { useRouter } from 'next/navigation';
import { Button, Skeleton } from '@/components/ui';

interface Offer {
  id: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  expiresAt: string;
  claimedCount: number;
  isFull: boolean;
}

interface ClaimedVoucher {
  claimId: string;
  couponId: string;
}

export default function OffersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: offers = [], isLoading } = useQuery<Offer[]>({
    queryKey: ['offers'],
    queryFn: () => api.get('/offers').then((r) => r.data),
    // Offers change rarely (admin-approved coupons) — cache for 5 min so
    // navigating back to this page returns instantly from cache instead of
    // re-hitting the API every time.
    staleTime: 5 * 60 * 1000,
  });

  const { data: myVouchers = [] } = useQuery<ClaimedVoucher[]>({
    queryKey: ['my-vouchers'],
    queryFn: () => api.get('/offers/my-vouchers').then((r) => r.data),
    enabled: !!user,
    // Claim state is invalidated explicitly on mutation; 5-min cache otherwise.
    staleTime: 5 * 60 * 1000,
  });

  const claimedIds = new Set(myVouchers.map((v) => v.couponId));

  const claimMutation = useMutation({
    mutationFn: (couponId: string) => api.post(`/offers/${couponId}/claim`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      queryClient.invalidateQueries({ queryKey: ['my-vouchers'] });
      toast(t('offers.toast.claimed'), 'success');
    },
    onError: (err) => toast(getApiError(err, 'Could not claim offer'), 'error'),
  });

  const daysLeft = (date: string) => {
    const diff = Math.ceil(
      (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (diff <= 0) return t('offers.expired');
    if (diff === 1) return t('offers.dayLeft');
    return `${diff} ${t('offers.daysLeft')}`;
  };

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-10"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-jadwal-accent-soft grid place-items-center mb-4">
              <Gift
                className="h-8 w-8 text-jadwal-accent"
                aria-hidden="true"
              />
            </div>
            <h1 className="font-display text-[28px] md:text-[34px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text leading-[1.15] m-0">
              {t('offers.title')}
            </h1>
            <p className="text-sm text-jadwal-text-muted mt-2 max-w-md mx-auto">
              {t('offers.subtitle')}
            </p>
          </motion.div>

          {/*
            CLS fix on this page is subtle: when there are zero offers
            (common during empty-DB seasons + soft-launch periods), the
            loaded state collapses to a small empty-state block (~250px)
            while the loading state previously rendered four 240px
            skeletons (~1000px). The 750px collapse pushed the footer
            up and produced a 0.18 mobile CLS hit. Naively bumping the
            skeleton count or height made it worse (turned a shrink
            into a stretch).
            Real fix: pin BOTH the loading and the empty state to the
            same single-row height as a single rendered card, so the
            grid container is identical in both states. When offers
            exist, the grid grows past the floor naturally — only the
            additional rows below add height, and they're symmetric in
            the loaded vs loading single-row case (one skeleton card
            per offer would be the next refinement, but for now we
            optimise for the empty-DB + 0-2-offers case which is the
            current launch reality).
          */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="min-h-60 rounded-2xl" />
              <Skeleton className="hidden sm:block min-h-60 rounded-2xl" />
            </div>
          ) : offers.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="min-h-60 flex flex-col items-center justify-center rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle text-center px-6 sm:col-span-2">
                <Tag
                  className="h-10 w-10 text-jadwal-text-faint mb-3"
                  aria-hidden="true"
                />
                <p className="text-jadwal-text-muted font-medium">
                  {t('offers.noOffers')}
                </p>
                <p className="text-xs text-jadwal-text-faint mt-1">
                  {t('offers.checkBack')}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {offers.map((offer, i) => {
                const isClaimed = claimedIds.has(offer.id);
                const discountLabel =
                  offer.discountType === 'PERCENTAGE'
                    ? `${offer.discountValue}% ${t('offers.off')}`
                    : `${offer.discountValue} QAR ${t('offers.off')}`;

                return (
                  <motion.div
                    key={offer.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.4) }}
                    /*
                      `min-h-60` here MUST match the skeleton's min-h
                      (line 116). Otherwise the page total height
                      changes between loading state and loaded state
                      and the footer below shifts — that was the
                      0.180 -> 0.232 mobile CLS hit on /offers.
                    */
                    className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle shadow-jadwal overflow-hidden min-h-60"
                  >
                    <div className="px-6 py-4 text-white bg-[linear-gradient(135deg,var(--color-jadwal-gold-500)_0%,var(--color-jadwal-gold-700)_100%)]">
                      <p className="font-display text-2xl font-bold tracking-[-0.5px] tabular-nums">
                        {discountLabel}
                      </p>
                      {offer.maxDiscount &&
                      offer.discountType === 'PERCENTAGE' ? (
                        <p className="text-xs opacity-90 mt-0.5">
                          {t('offers.upTo', {
                            defaultValue: 'Up to {{n}} QAR',
                            n: offer.maxDiscount,
                          })}{' '}
                          {t('offers.maxDiscount')}
                        </p>
                      ) : null}
                    </div>

                    <div className="px-6 py-5 flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-sm text-jadwal-text-muted">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {daysLeft(offer.expiresAt)}
                      </div>

                      {offer.minOrderAmount ? (
                        <p className="text-xs text-jadwal-text-faint">
                          {t('offers.minOrder')}: {offer.minOrderAmount} QAR
                        </p>
                      ) : null}

                      {isClaimed ? (
                        <div className="flex items-center gap-2 text-sm text-jadwal-success font-medium">
                          <CheckCircle
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          {t('offers.claimed')}
                        </div>
                      ) : offer.isFull ? (
                        <p className="text-sm text-jadwal-text-muted">
                          {t('offers.fullyClaimed')}
                        </p>
                      ) : !user ? (
                        <Button
                          full
                          variant="gold"
                          onClick={() =>
                            router.push(`/login?callbackUrl=/offers`)
                          }
                        >
                          {t('offers.loginToClaim')}
                        </Button>
                      ) : (
                        <Button
                          full
                          variant="gold"
                          onClick={() => claimMutation.mutate(offer.id)}
                          disabled={claimMutation.isPending}
                          loading={claimMutation.isPending}
                        >
                          {t('offers.claimOffer')}
                        </Button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
