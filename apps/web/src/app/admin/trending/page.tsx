'use client';

import React, { useState, useCallback } from 'react';
import NextImage from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Plus, Pencil, Trash2, X, Calendar, Clock, ImageIcon, AlertTriangle, MapPin } from 'lucide-react';
import DatePicker from '@/components/date-picker';
import TimePicker from '@/components/time-picker';

interface TrendingEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  image: string | null;
  eventDate: string | null;
  countryId: string | null;
  isActive: boolean;
  createdAt: string;
  country?: { nameEn: string } | null;
}

const inputCls =
  'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

function TableSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-72 bg-gray-100 dark:bg-slate-800/60 rounded-2xl animate-pulse" />
      ))}
    </div>
  );
}

const emptyForm = {
  titleEn: '',
  titleAr: '',
  description: '',
  image: '',
  eventDate: '',
  eventTime: '',
  countryId: '',
  isActive: true,
};

export default function AdminTrendingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: events, isLoading } = useQuery<TrendingEvent[]>({
    queryKey: ['admin', 'trending'],
    queryFn: async () => {
      const { data } = await api.get('/admin/settings/trending');
      return data;
    },
  });

  const { data: countries = [] } = useQuery<{ id: string; nameEn: string }[]>({
    queryKey: ['admin', 'settings', 'countries'],
    queryFn: () => api.get('/admin/settings/countries').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });


  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      await api.post('/admin/settings/trending', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trending'] });
      closeModal();
      toast('Trending item created');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to create trending item'), 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      await api.patch(`/admin/settings/trending/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trending'] });
      closeModal();
      toast('Trending item updated');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to update trending item'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/settings/trending/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trending'] });
      setDeleteConfirm(null);
      toast('Trending item deleted');
    },
    onError: () => { toast('Failed to delete trending item', 'error'); },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await api.patch(`/admin/settings/trending/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trending'] });
    },
    onError: () => { toast('Failed to toggle status', 'error'); },
  });

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setImagePreview(null);
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setImagePreview(null);
    setModalOpen(true);
  };

  const openEdit = (event: TrendingEvent) => {
    const dateStr = event.eventDate ? new Date(event.eventDate).toISOString().slice(0, 10) : '';
    const timeStr = event.eventDate ? new Date(event.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    setForm({
      titleEn: event.titleEn,
      titleAr: event.titleAr,
      description: event.description || '',
      image: event.image || '',
      eventDate: dateStr,
      eventTime: timeStr,
      countryId: event.countryId || '',
      isActive: event.isActive,
    });
    setImagePreview(event.image || null);
    setEditingId(event.id);
    setModalOpen(true);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Compress client-side before upload
    const { compressImage } = await import('@/lib/compress-image');
    const compressed = await compressImage(file);

    // Show local preview immediately while uploading
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(compressed);

    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', compressed);
      const { data } = await api.post<{ url: string }>('/admin/settings/trending/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((f) => ({ ...f, image: data.url }));
      setImagePreview(data.url);
    } catch (err) {
      toast(getApiError(err, 'Failed to upload image'), 'error');
      setImagePreview(null);
      setForm((f) => ({ ...f, image: '' }));
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Guard: reject past dates on the client before hitting the API
    if (form.eventDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const picked = new Date(form.eventDate + 'T00:00:00');
      if (picked < today) {
        toast('Event date cannot be in the past', 'error');
        return;
      }
    }

    const payload: any = {
      titleEn: sanitize(form.titleEn),
      titleAr: sanitize(form.titleAr),
      description: form.description ? sanitize(form.description) : undefined,
      image: form.image || undefined,
      countryId: form.countryId || undefined,
      isActive: form.isActive,
    };
    if (form.eventDate) {
      const dateTime = form.eventTime ? `${form.eventDate}T${form.eventTime}:00` : `${form.eventDate}T00:00:00`;
      payload.eventDate = new Date(dateTime).toISOString();
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <AdminLayout title="Trending Management" subtitle="Manage trending events and featured activities displayed on the platform.">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {events?.length ?? 0} trending item{events?.length !== 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Trending Item
        </button>
      </div>

      {/* Events Grid */}
      {isLoading ? (
        <TableSkeleton />
      ) : events?.length === 0 ? (
        <div className="text-center py-20">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800/60 flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-gray-400 dark:text-slate-500" />
          </div>
          <p className="text-gray-500 dark:text-slate-400 text-sm mb-4">No trending items yet</p>
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer"
          >
            Add Your First Item
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {events?.map((event) => {
            return (
              <div
                key={event.id}
                className="group rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden hover:shadow-lg hover:shadow-blue-500/5 transition-all"
              >
                {/* Image */}
                <div className="relative h-44 bg-linear-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5 overflow-hidden">
                  {event.image ? (
                    <img
                      src={event.image}
                      alt={event.titleEn}
                      className="w-full h-full object-cover"
                      width={400}
                      height={176}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <ImageIcon className="h-12 w-12 text-gray-300 dark:text-slate-700" />
                    </div>
                  )}
                  {/* Status badge */}
                  <div className="absolute top-3 inset-e-3">
                    <button
                      type="button"
                      onClick={() => toggleActiveMutation.mutate({ id: event.id, isActive: !event.isActive })}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                        event.isActive
                          ? 'bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/30'
                          : 'bg-gray-500/80 text-white'
                      }`}
                    >
                      {event.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1 line-clamp-1">{event.titleEn}</h3>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mb-2 line-clamp-1">{event.titleAr}</p>
                  {event.description && (
                    <p className="text-xs text-gray-500 dark:text-slate-400 mb-3 line-clamp-2">{event.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    {event.countryId ? (
                      <div className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                        <MapPin className="h-3 w-3" />
                        {countries.find((c) => c.id === event.countryId)?.nameEn ?? 'Country'}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
                        Global
                      </div>
                    )}
                    {event.eventDate && (
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(event.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}
                    {event.eventDate && (
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(event.eventDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => openEdit(event)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ id: event.id, title: event.titleEn })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-2xl mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {editingId ? 'Edit Trending Item' : 'Add Trending Item'}
              </h3>
              <button type="button" onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-5">

                {/* ── Left: Image ── */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Image</label>
                  <div
                    className="relative flex-1 min-h-[200px] rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 flex items-center justify-center overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
                    onClick={() => document.getElementById('trending-image-input')?.click()}
                  >
                    {isUploadingImage ? (
                      <div className="text-center">
                        <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-[11px] text-gray-400">Uploading...</p>
                      </div>
                    ) : imagePreview ? (
                      <NextImage
                        src={imagePreview}
                        alt="Preview"
                        fill
                        sizes="180px"
                        unoptimized={process.env.NODE_ENV !== 'production'}
                        className="object-cover"
                      />
                    ) : (
                      <div className="text-center px-2">
                        <ImageIcon className="h-7 w-7 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                        <p className="text-[11px] text-gray-400 dark:text-slate-500">Click to upload</p>
                        <p className="text-[10px] text-gray-300 dark:text-slate-600 mt-0.5">JPG, PNG, WebP</p>
                      </div>
                    )}
                    <input id="trending-image-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} className="hidden" />
                  </div>
                </div>

                {/* ── Right: Fields ── */}
                <div className="space-y-2.5">
                  {/* Titles */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className={labelCls}>Title (EN)</label>
                      <input type="text" required value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} placeholder="Event title" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Title (AR)</label>
                      <input type="text" required value={form.titleAr} onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))} placeholder="عنوان الحدث" dir="rtl" className={inputCls} />
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Event description" rows={2} className={inputCls} />
                  </div>

                  {/* Country */}
                  <div>
                    <label className={labelCls}>Country</label>
                    <select
                      value={form.countryId}
                      onChange={(e) => setForm((f) => ({ ...f, countryId: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Global (all countries)</option>
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>{c.nameEn}</option>
                      ))}
                    </select>
                  </div>

                  {/* Date & Time */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className={labelCls}>Event Date</label>
                      <DatePicker value={form.eventDate} onChange={(val) => setForm((f) => ({ ...f, eventDate: val }))} placeholder="Pick a date" direction="up" disablePast />
                    </div>
                    <div>
                      <label className={labelCls}>Event Time</label>
                      <TimePicker value={form.eventTime} onChange={(val) => setForm((f) => ({ ...f, eventTime: val }))} placeholder="Pick a time" direction="up" />
                    </div>
                  </div>

                  {/* Active + Buttons */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.isActive ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-700'}`}
                      >
                        <span className={`absolute top-0.5 inset-s-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-sm text-gray-600 dark:text-slate-400">Active</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={closeModal} className="px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                        Cancel
                      </button>
                      <button type="submit" disabled={createMutation.isPending || updateMutation.isPending || isUploadingImage} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                        {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editingId ? 'Save Changes' : 'Create Item'}
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Trending Item</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
              Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.title}</span>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
