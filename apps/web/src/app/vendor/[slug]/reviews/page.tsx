'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import { VendorSidebar } from '../../_components/vendor-sidebar';
import { MessageSquare, Star, ChevronLeft, ChevronRight, Send, Loader2 } from 'lucide-react';

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-slate-600'}`} />
      ))}
    </div>
  );
}

export default function VendorReviewsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: [user?.id, 'vendor-reviews', page],
    queryFn: () => api.get('/vendor/reviews', { params: { page, limit: 20 } }).then(r => r.data),
    enabled: !!user,
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) =>
      api.patch(`/vendor/reviews/${id}/reply`, { reply }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [user?.id, 'vendor-reviews'] });
      toast(t('vendor.reviews.toast.replyPosted'), 'success');
      setReplyingTo(null);
      setReplyText('');
    },
    onError: () => toast(t('vendor.reviews.toast.replyFailed'), 'error'),
  });

  const handleSubmitReply = (reviewId: string) => {
    const clean = sanitize(replyText.trim());
    if (!clean) return;
    replyMutation.mutate({ id: reviewId, reply: clean });
  };

  const reviews = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <VendorSidebar />

      <main className="md:ms-64 p-4 max-md:pt-16 md:p-10 overflow-x-hidden">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t('vendor.reviews.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">{t('vendor.reviews.subtitle')}</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <MessageSquare className="h-12 w-12 text-gray-300 dark:text-slate-600 mb-4" />
            <p className="text-gray-500 dark:text-slate-400 font-medium text-lg">{t('vendor.reviews.emptyTitle')}</p>
            <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">{t('vendor.reviews.emptySubtitle')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review: any) => (
              <div key={review.id} className="bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 rounded-2xl p-6">
                {/* Review header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-sm font-bold text-teal-700 dark:text-teal-400 flex-shrink-0">
                      {review.customer?.fullName?.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900 dark:text-white">{review.customer?.fullName}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{localized(review.activity, 'title')}</p>
                    </div>
                  </div>
                  <div className="text-end">
                    <StarDisplay rating={review.rating} />
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{new Date(review.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                {/* Review text */}
                {review.text && (
                  <p className="text-sm text-gray-700 dark:text-slate-300 mb-4 leading-relaxed">{review.text}</p>
                )}

                {/* Existing reply */}
                {review.vendorReply && replyingTo !== review.id && (
                  <div className="mt-3 ms-4 ps-4 border-s-2 border-teal-300 dark:border-teal-700">
                    <p className="text-xs font-semibold text-teal-600 dark:text-teal-400 mb-1">{t('vendor.reviews.yourReply')}</p>
                    <p className="text-sm text-gray-600 dark:text-slate-300">{review.vendorReply}</p>
                    <button
                      onClick={() => { setReplyingTo(review.id); setReplyText(review.vendorReply); }}
                      className="text-xs text-gray-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 mt-1 transition-colors"
                    >
                      {t('vendor.reviews.editReply')}
                    </button>
                  </div>
                )}

                {/* Reply form */}
                {replyingTo === review.id ? (
                  <div className="mt-4">
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder={t('vendor.reviews.replyPlaceholder')}
                      rows={3}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 resize-none"
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => { setReplyingTo(null); setReplyText(''); }}
                        className="px-4 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        {t('vendor.reviews.cancel')}
                      </button>
                      <button
                        onClick={() => handleSubmitReply(review.id)}
                        disabled={!replyText.trim() || replyMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {replyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        {t('vendor.reviews.postReply')}
                      </button>
                    </div>
                  </div>
                ) : !review.vendorReply && (
                  <button
                    onClick={() => { setReplyingTo(review.id); setReplyText(''); }}
                    className="mt-3 flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {t('vendor.reviews.replyToReview')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('vendor.reviews.pagination.pageOf', { page, total: totalPages })}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
