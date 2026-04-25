'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Tag,
  Layers,
  CalendarRange,
  Upload,
  Loader2,
} from 'lucide-react';

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

const inputCls =
  'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMG_SIZE = 10 * 1024 * 1024; // 10 MB (compressed before upload)

export default function AdminCategoriesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState<any>(null);
  const [parentForSub, setParentForSub] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; type: 'category' | 'subcategory' } | null>(null);

  // Category form state
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [slug, setSlug] = useState('');
  const [catCommission, setCatCommission] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // Subcategory form state
  const [subNameEn, setSubNameEn] = useState('');
  const [subNameAr, setSubNameAr] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.get('/admin/settings/categories').then((r) => r.data),
  });

  const topLevel = categories.filter((c: any) => !c.parentId);
  const totalSubcategories = categories.filter((c: any) => c.parentId).length;
  const totalActivities = categories.reduce((sum: number, c: any) => sum + (c._count?.activities ?? 0), 0);

  async function handleImageUpload(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError('Only JPG, PNG, WebP, or GIF allowed');
      return;
    }
    if (file.size > MAX_IMG_SIZE) {
      setImageError('Image must be under 10 MB');
      return;
    }
    setImageError('');
    setImageUploading(true);

    // Compress client-side before upload
    const { compressImage } = await import('@/lib/compress-image');
    const compressed = await compressImage(file);
    setImagePreview(URL.createObjectURL(compressed));

    try {
      const formData = new FormData();
      formData.append('file', compressed);
      const res = await api.post('/admin/upload-category-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.url);
    } catch {
      setImageError('Upload failed. Try again.');
      setImagePreview('');
      setImageUrl('');
    } finally {
      setImageUploading(false);
    }
  }

  function clearImage() {
    if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageUrl('');
    setImagePreview('');
    setImageError('');
  }

  function openAddModal() {
    setEditingCategory(null);
    setNameEn('');
    setNameAr('');
    setSlug('');
    setCatCommission('');
    setImageUrl('');
    setImagePreview('');
    setImageError('');
    setModalOpen(true);
  }

  function openEditModal(cat: any) {
    setEditingCategory(cat);
    setNameEn(cat.nameEn);
    setNameAr(cat.nameAr);
    setSlug(cat.slug);
    setCatCommission(cat.commissionPct != null ? String(cat.commissionPct) : '');
    setImageUrl(cat.image || '');
    setImagePreview(cat.image || '');
    setImageError('');
    setModalOpen(true);
  }

  function openAddSubModal(parent: any) {
    setParentForSub(parent);
    setEditingSubcategory(null);
    setSubNameEn('');
    setSubNameAr('');
    setSubModalOpen(true);
  }

  function openEditSubModal(sub: any, parent: any) {
    setParentForSub(parent);
    setEditingSubcategory(sub);
    setSubNameEn(sub.nameEn);
    setSubNameAr(sub.nameAr);
    setSubModalOpen(true);
  }

  // Mutations
  const createCategoryMutation = useMutation({
    mutationFn: (payload: any) => api.post('/admin/settings/categories', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setModalOpen(false);
      toast('Category created successfully');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to create category'), 'error');
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.patch(`/admin/settings/categories/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setModalOpen(false);
      toast('Category updated');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to update category'), 'error');
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/settings/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setDeleteConfirm(null);
      toast('Category deleted');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to delete category'), 'error');
    },
  });

  const createSubcategoryMutation = useMutation({
    mutationFn: (payload: any) => api.post('/admin/settings/categories', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setSubModalOpen(false);
      toast('Subcategory created');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to create subcategory'), 'error');
    },
  });

  const updateSubcategoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.patch(`/admin/settings/categories/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setSubModalOpen(false);
      toast('Subcategory updated');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to update subcategory'), 'error');
    },
  });

  const deleteSubcategoryMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/settings/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setDeleteConfirm(null);
      toast('Subcategory deleted');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to delete subcategory'), 'error');
    },
  });

  function handleCategorySubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      nameEn: sanitize(nameEn),
      nameAr: sanitize(nameAr),
      slug: sanitize(slug),
      commissionPct: catCommission ? Number(catCommission) : null,
    };
    if (imageUrl) payload.image = imageUrl;
    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, payload });
    } else {
      createCategoryMutation.mutate(payload);
    }
  }

  function handleSubSubmit(e: React.FormEvent) {
    e.preventDefault();
    const genSlug = slugify(subNameEn);
    const payload = {
      nameEn: sanitize(subNameEn),
      nameAr: sanitize(subNameAr),
      slug: genSlug,
      parentId: parentForSub.id,
    };
    if (editingSubcategory) {
      updateSubcategoryMutation.mutate({
        id: editingSubcategory.id,
        payload: { nameEn: sanitize(subNameEn), nameAr: sanitize(subNameAr) },
      });
    } else {
      createSubcategoryMutation.mutate(payload);
    }
  }

  function handleDeleteConfirm() {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'subcategory') {
      deleteSubcategoryMutation.mutate(deleteConfirm.id);
    } else {
      deleteCategoryMutation.mutate(deleteConfirm.id);
    }
  }

  const isDeleting = deleteCategoryMutation.isPending || deleteSubcategoryMutation.isPending;
  const isSavingCat = createCategoryMutation.isPending || updateCategoryMutation.isPending;
  const isSavingSub = createSubcategoryMutation.isPending || updateSubcategoryMutation.isPending;

  return (
    <AdminLayout title="Categories" subtitle="Manage activity categories and subcategories">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Categories', value: topLevel.length, icon: Tag, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
          { label: 'Total Subcategories', value: totalSubcategories, icon: Layers, color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
          { label: 'Total Activities', value: totalActivities, icon: CalendarRange, color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white dark:bg-slate-900/50 rounded-2xl p-5 border border-gray-200/80 dark:border-slate-800/80 flex items-center gap-4">
            <div className={`p-3 rounded-xl ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{isLoading ? '—' : value}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">All Categories</h2>
        <button
          type="button"
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider w-8"></th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider w-14">Image</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Name (EN)</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Name (AR)</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Slug</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Subcategories</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activities</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {topLevel.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No categories yet. Add one above.</td>
                  </tr>
                )}
                {topLevel.map((cat: any) => {
                  const children = categories.filter((c: any) => c.parentId === cat.id);
                  const isExpanded = expandedCategory === cat.id;
                  return (
                    <React.Fragment key={cat.id}>
                      <tr className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="ps-4 py-4">
                          <button
                            type="button"
                            onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-gray-400" />
                              : <ChevronRight className="h-4 w-4 text-gray-400" />}
                          </button>
                        </td>
                        <td className="px-3 py-4">
                          {cat.image ? (
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={cat.image} alt={cat.nameEn} width={40} height={40} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-linear-to-br from-blue-500/20 to-indigo-500/20 dark:from-blue-500/30 dark:to-indigo-500/30 flex items-center justify-center text-sm font-bold text-blue-600 dark:text-blue-400">
                              {cat.nameEn?.charAt(0) || '?'}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{cat.nameEn}</td>
                        <td className="px-6 py-4 text-gray-700 dark:text-slate-300" dir="rtl">{cat.nameAr}</td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{cat.slug}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                            {children.length}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300 text-xs">{cat._count?.activities ?? 0}</td>
                        <td className="px-6 py-4 text-end">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(cat)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-all cursor-pointer"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm({ id: cat.id, name: cat.nameEn, type: 'category' })}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-all cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${cat.id}-sub`}>
                          <td colSpan={8} className="bg-gray-50/70 dark:bg-slate-800/20 px-6 py-4">
                            <div className="ms-6">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                  Subcategories of {cat.nameEn}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => openAddSubModal(cat)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-all cursor-pointer"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add Subcategory
                                </button>
                              </div>
                              {children.length === 0 ? (
                                <p className="text-xs text-gray-400 dark:text-slate-500 py-2">No subcategories yet.</p>
                              ) : (
                                <div className="rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900/50">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-gray-100 dark:border-slate-800">
                                        <th className="text-start px-4 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Name (EN)</th>
                                        <th className="text-start px-4 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Name (AR)</th>
                                        <th className="text-start px-4 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Slug</th>
                                        <th className="text-start px-4 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Activities</th>
                                        <th className="text-end px-4 py-3 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                                      {children.map((sub: any) => (
                                        <tr key={sub.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20 transition-colors">
                                          <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{sub.nameEn}</td>
                                          <td className="px-4 py-3 text-gray-700 dark:text-slate-300" dir="rtl">{sub.nameAr}</td>
                                          <td className="px-4 py-3">
                                            <span className="font-mono text-xs text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{sub.slug}</span>
                                          </td>
                                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{sub._count?.activities ?? 0}</td>
                                          <td className="px-4 py-3 text-end">
                                            <div className="flex items-center justify-end gap-1">
                                              <button
                                                type="button"
                                                onClick={() => openEditSubModal(sub, cat)}
                                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-all cursor-pointer"
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setDeleteConfirm({ id: sub.id, name: sub.nameEn, type: 'subcategory' })}
                                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-all cursor-pointer"
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleCategorySubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Name English <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={nameEn}
                  onChange={(e) => {
                    setNameEn(e.target.value);
                    if (!editingCategory) setSlug(slugify(e.target.value));
                  }}
                  required
                  placeholder="e.g. Water Sports"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Name Arabic <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  required
                  dir="rtl"
                  placeholder="مثال: الرياضات المائية"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Slug <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  required
                  placeholder="e.g. water-sports"
                  className={`${inputCls} font-mono`}
                />
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Lowercase letters, numbers and hyphens only.</p>
              </div>

              <div>
                <label className={labelCls}>Commission Override (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={catCommission}
                  onChange={(e) => setCatCommission(e.target.value)}
                  placeholder="Leave empty to use platform default"
                  className={inputCls}
                />
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Optional. Overrides the platform default for all vendors in this category.</p>
              </div>

              {/* Image Upload */}
              <div>
                <label className={labelCls}>Category Image</label>
                {imagePreview || imageUrl ? (
                  <div className="relative group w-full h-36 rounded-xl overflow-hidden border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview || imageUrl}
                      alt="Category"
                      width={480}
                      height={144}
                      decoding="async"
                      className={`w-full h-full object-cover transition-opacity ${imageUploading ? 'opacity-40' : 'opacity-100'}`}
                    />
                    {imageUploading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                      </div>
                    )}
                    {!imageUploading && (
                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute top-2 inset-e-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => imageInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-400'); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('border-blue-400');
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleImageUpload(file);
                    }}
                    className="cursor-pointer rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors p-6 flex flex-col items-center justify-center gap-2 text-center"
                  >
                    <div className="p-2.5 rounded-full bg-gray-100 dark:bg-slate-800">
                      <Upload className="h-5 w-5 text-gray-400 dark:text-slate-500" />
                    </div>
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                      Drag & drop or click to upload
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">
                      JPG, PNG, WebP, GIF · Max 5 MB
                    </p>
                  </div>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
                {imageError && (
                  <p className="text-xs text-red-500 mt-1">{imageError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSavingCat} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                  {isSavingCat ? 'Saving...' : editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subcategory Modal */}
      {subModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingSubcategory ? 'Edit Subcategory' : 'Add Subcategory'}
              </h3>
              <button type="button" onClick={() => setSubModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Parent Category</label>
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-600 dark:text-slate-300">
                  {parentForSub?.nameEn}
                </div>
              </div>
              <div>
                <label className={labelCls}>Sub Name English <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={subNameEn}
                  onChange={(e) => setSubNameEn(e.target.value)}
                  required
                  placeholder="e.g. Kayaking"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Sub Name Arabic <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={subNameAr}
                  onChange={(e) => setSubNameAr(e.target.value)}
                  required
                  dir="rtl"
                  placeholder="مثال: التجديف"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSubModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSavingSub} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                  {isSavingSub ? 'Saving...' : editingSubcategory ? 'Save Changes' : 'Create Subcategory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Delete {deleteConfirm.type === 'subcategory' ? 'Subcategory' : 'Category'}
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
              Delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer">Cancel</button>
              <button type="button" onClick={handleDeleteConfirm} disabled={isDeleting} className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50 cursor-pointer">
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
