'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/components/toast';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import AdminLayout from '../_components/admin-layout';
import { Search, ChevronLeft, ChevronRight, Star, Trash2, AlertTriangle } from 'lucide-react';

interface Review {
  id: string;
  rating: number;
  text: string | null;
  vendorReply: string | null;
  createdAt: string;
  customer: { fullName: string; email: string };
  activity: { titleEn: string };
}

interface ReviewsResponse {
  data: Review[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminReviewsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ReviewsResponse>({
    queryKey: ['admin', 'reviews', page, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      const { data } = await api.get(`/admin/reviews?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      await api.delete(`/admin/reviews/${reviewId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      toast('Review deleted successfully');
    },
    onError: () => { toast('Failed to delete review', 'error'); },
  });

  return (
    <AdminLayout title="Reviews" subtitle="Moderate customer reviews">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search by text or customer name..."
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activity</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Rating</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Review</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No reviews found.</td>
                  </tr>
                )}
                {data?.data.map((review) => (
                  <tr key={review.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{review.customer.fullName}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500">{review.customer.email}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300">{review.activity.titleEn}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-3.5 w-3.5 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 dark:text-slate-600'}`} />
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300 max-w-xs truncate">{review.text || '—'}</td>
                    <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                      {new Date(review.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-end">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm({ id: review.id })}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-all"
                        title="Delete review"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Showing {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
                <span className="text-xs text-gray-600 dark:text-slate-400 font-medium">{data.page} / {data.totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-all">
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Review</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">Are you sure you want to delete this review? This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer">Cancel</button>
              <button type="button" onClick={() => { deleteMutation.mutate(deleteConfirm.id); setDeleteConfirm(null); }} className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all cursor-pointer">Delete</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
