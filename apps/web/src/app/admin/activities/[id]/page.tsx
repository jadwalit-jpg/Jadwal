'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { sanitize, sanitizeObject } from '@/lib/validation';
import AdminLayout from '../../_components/admin-layout';
import { Check, Loader2, X, BookmarkIcon, AlertTriangle, ImagePlus } from 'lucide-react';
import { LocationPicker } from '@/components/location-picker';
import { useToast } from '@/components/toast';
import CustomSelect from '@/components/custom-select';
import ImageUploader from '@/components/image-uploader';
import TimePicker from '@/components/time-picker';
import { ACCEPTED_IMAGE_TYPES, MAX_COVER_SIZE, MAX_IMAGE_DIM } from '@/lib/image-constants';

const DAYS_OF_WEEK = [
  { label: 'Sunday', value: 'SUN' },
  { label: 'Monday', value: 'MON' },
  { label: 'Tuesday', value: 'TUE' },
  { label: 'Wednesday', value: 'WED' },
  { label: 'Thursday', value: 'THU' },
  { label: 'Friday', value: 'FRI' },
  { label: 'Saturday', value: 'SAT' },
];

/* ─── Cover Image Uploader ───────────────────────────────────── */

async function compressCoverImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => { resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }) : file); },
        'image/webp', 0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function CoverImageUploader({ value, onChange, error }: { value: string; onChange: (url: string) => void; error?: string }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>(value || '');
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (value && !preview) setPreview(value); }, [value, preview]);

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { setUploadError('Invalid file type. Use JPG, PNG, WebP, or GIF.'); return; }
    if (file.size > MAX_COVER_SIZE) { setUploadError('File too large. Max 5 MB.'); return; }
    setUploadError(''); setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    try {
      const compressed = await compressCoverImage(file);
      const fd = new FormData(); fd.append('file', compressed);
      const { data } = await api.post('/upload/image', fd);
      onChange(data.url);
      URL.revokeObjectURL(objectUrl);
    } catch { setUploadError('Upload failed. Try again.'); setPreview(value); }
    finally { setUploading(false); }
  }, [onChange, value]);

  return (
    <div>
      {preview ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 max-w-[480px]">
          <img src={preview} alt="Cover" width={480} height={224} decoding="async" className="w-full h-56 object-cover" />
          {uploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="h-6 w-6 text-white animate-spin" /></div>}
          <button type="button" onClick={() => { setPreview(''); onChange(''); }} className="absolute top-2 end-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className={`w-full max-w-[480px] h-56 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer ${error ? 'border-red-400 bg-red-50/50' : 'border-gray-300 dark:border-slate-600 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'}`}>
          <ImagePlus className="h-8 w-8 text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-slate-400">Click to upload cover image</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      {(error || uploadError) && <p className="text-xs text-red-500 mt-1">{uploadError || error}</p>}
    </div>
  );
}

/* ─── Steps ──────────────────────────────────────────────────── */

const STEPS = [
  { id: 1, label: 'Basic Info' },
  { id: 2, label: 'Details' },
  { id: 3, label: 'Pricing' },
  { id: 4, label: 'Location' },
  { id: 5, label: 'Media' },
  { id: 6, label: 'Policies' },
];

/* ─── Component ──────────────────────────────────────────────── */

export default function AdminEditActivityPage() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activityId = params.id as string;

  const [currentStep, setCurrentStep] = useState(1);
  const [initialized, setInitialized] = useState(false);

  const [form, setForm] = useState({
    titleEn: '', titleAr: '', slug: '', descriptionEn: '', descriptionAr: '',
    categoryId: '', subCategoryId: '', pricePerPerson: '', durationValue: '',
    pricingModel: 'PER_PERSON' as 'PER_PERSON' | 'PER_UNIT',
    capacity: '', locationLat: '', locationLng: '', locationAddress: '', cityId: '',
    bookingType: 'HOURLY' as 'HOURLY' | 'DAILY', cancellationPolicy: '',
    checkInTime: '', checkOutTime: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverImage, setCoverImage] = useState<string>('');
  const [gallery, setGallery] = useState<string[]>([]);
  const [extraServices, setExtraServices] = useState<{ name: string; price: number; perPerson: boolean }[]>([]);
  const [extraName, setExtraName] = useState('');
  const [extraPrice, setExtraPrice] = useState('');
  const [extraPerPerson, setExtraPerPerson] = useState(false);
  const [activeDays, setActiveDays] = useState<string[]>([]);
  const [hasUnits, setHasUnits] = useState(false);
  const [unitCount, setUnitCount] = useState('');
  const [unitCapacity, setUnitCapacity] = useState('');

  // Fetch activity
  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['admin', 'activity', activityId],
    queryFn: () => api.get(`/admin/activities/${activityId}`).then(r => r.data),
    enabled: !!activityId,
  });

  const { data: categories } = useQuery({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then(r => r.data),
  });

  // Cities by the activity's country
  const countryId = activity?.vendor?.countryId || activity?.countryId;
  const { data: cities } = useQuery({
    queryKey: [countryId, 'cities'],
    queryFn: () => api.get(`/catalog/cities/${countryId}`).then(r => r.data),
    staleTime: 10 * 60 * 1000,
    enabled: !!countryId,
  });

  // Pre-populate form
  useEffect(() => {
    if (activity && !initialized) {
      setForm({
        titleEn: activity.titleEn ?? '', titleAr: activity.titleAr ?? '', slug: activity.slug ?? '',
        descriptionEn: activity.descriptionEn ?? '', descriptionAr: activity.descriptionAr ?? '',
        categoryId: activity.categoryId ?? '', subCategoryId: activity.subCategoryId ?? '',
        pricePerPerson: activity.pricePerPerson != null ? String(activity.pricePerPerson) : '',
        durationValue: activity.durationValue != null ? String(activity.durationValue) : '',
        pricingModel: (activity.pricingModel ?? 'PER_PERSON') as 'PER_PERSON' | 'PER_UNIT',
        capacity: activity.capacity != null ? String(activity.capacity) : '',
        locationLat: activity.locationLat != null ? String(activity.locationLat) : '',
        locationLng: activity.locationLng != null ? String(activity.locationLng) : '',
        locationAddress: activity.locationAddress ?? '', cityId: activity.cityId ?? '',
        bookingType: activity.bookingType ?? 'HOURLY', cancellationPolicy: activity.cancellationPolicy ?? '',
        checkInTime: activity.checkInTime ?? '', checkOutTime: activity.checkOutTime ?? '',
      });
      setCoverImage(activity.coverImage ?? '');
      setGallery(Array.isArray(activity.gallery) ? activity.gallery : []);
      setExtraServices(Array.isArray(activity.extraServices) ? activity.extraServices.map((s: any) => ({ name: s.name, price: s.price ?? 0, perPerson: !!s.perPerson })) : []);
      setActiveDays(Array.isArray(activity.activeDays) ? activity.activeDays : []);
      if (activity.hasUnits) { setHasUnits(true); setUnitCount(activity.unitCount != null ? String(activity.unitCount) : ''); setUnitCapacity(activity.unitCapacity != null ? String(activity.unitCapacity) : ''); }
      setInitialized(true);
    }
  }, [activity, initialized]);

  const selectedCategory = categories?.find((c: any) => c.id === form.categoryId);
  const subCategories = selectedCategory?.children ?? [];

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.patch(`/admin/activities/${activityId}`, data),
    onSuccess: () => {
      toast('Activity updated successfully!', 'success');
      queryClient.invalidateQueries({ queryKey: ['admin', 'activities'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'activity', activityId] });
      router.push('/admin/activities');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to update activity'), 'error'); },
  });

  // ─── Validation ──────────────────────────────────────────────
  const validateStep = (step: number): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!form.titleEn.trim()) errs.titleEn = 'English title is required';
      else if (form.titleEn.trim().length < 5) errs.titleEn = 'Title must be at least 5 characters';
      if (!form.titleAr.trim()) errs.titleAr = 'Arabic title is required';
      else if (form.titleAr.trim().length < 5) errs.titleAr = 'Title must be at least 5 characters';
      if (!form.slug.trim()) errs.slug = 'Slug is required';
      if (!form.categoryId) errs.categoryId = 'Category is required';
      if (!form.descriptionEn.trim()) errs.descriptionEn = 'English description is required';
      else if (form.descriptionEn.trim().length < 50) errs.descriptionEn = 'Description must be at least 50 characters';
      if (!form.descriptionAr.trim()) errs.descriptionAr = 'Arabic description is required';
      else if (form.descriptionAr.trim().length < 50) errs.descriptionAr = 'Description must be at least 50 characters';
    }
    if (step === 2) {
      if (form.bookingType === 'HOURLY') {
        if (!form.durationValue || Number(form.durationValue) < 1) errs.durationValue = 'Duration must be at least 1';
        if (!form.checkInTime) errs.checkInTime = 'Start time is required';
        if (!form.checkOutTime) errs.checkOutTime = 'End time is required';
        if (form.checkInTime && form.checkOutTime && form.checkInTime >= form.checkOutTime) errs.checkOutTime = 'End time must be after start time';
      } else {
        if (!form.checkInTime) errs.checkInTime = 'Check-in time is required';
        if (!form.checkOutTime) errs.checkOutTime = 'Check-out time is required';
      }
    }
    if (step === 3) {
      if (!form.pricePerPerson || Number(form.pricePerPerson) <= 0) errs.pricePerPerson = 'Valid price is required';
    }
    if (step === 4) {
      if (!form.cityId) errs.cityId = 'City is required';
      if (!form.locationAddress.trim()) errs.locationAddress = 'Location name is required';
    }
    if (step === 5) {
      if (!coverImage) errs.coverImage = 'Cover image is required';
      if (gallery.length < 2) errs.gallery = 'Please upload at least 2 gallery images';
    }
    if (step === 6) {
      if (!form.cancellationPolicy) errs.cancellationPolicy = 'Please select a cancellation policy';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => { if (!validateStep(currentStep)) return; setCurrentStep(s => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const handleStepClick = (target: number) => {
    if (target === currentStep) return;
    if (target < currentStep) { setCurrentStep(target); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    for (let s = currentStep; s < target; s++) { if (!validateStep(s)) { setCurrentStep(s); return; } }
    setCurrentStep(target); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleBack = () => { setCurrentStep(s => s - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const handleSubmit = () => {
    if (!validateStep(currentStep)) return;
    const totalCapacity = hasUnits && Number(unitCount) > 0 ? Number(unitCount) * (Number(unitCapacity) || 1) : (form.capacity ? Number(form.capacity) : undefined);
    const payload = sanitizeObject({
      titleEn: sanitize(form.titleEn), titleAr: sanitize(form.titleAr), slug: sanitize(form.slug),
      descriptionEn: sanitize(form.descriptionEn), descriptionAr: sanitize(form.descriptionAr),
      categoryId: form.categoryId, subCategoryId: form.subCategoryId || undefined,
      pricePerPerson: Number(form.pricePerPerson),
      durationValue: form.bookingType === 'HOURLY' ? (Number(form.durationValue) || undefined) : undefined,
      pricingModel: form.bookingType === 'DAILY' ? 'PER_UNIT' : form.pricingModel,
      capacity: totalCapacity,
      locationLat: Number(form.locationLat), locationLng: Number(form.locationLng),
      locationAddress: sanitize(form.locationAddress), cityId: form.cityId,
      bookingType: form.bookingType, cancellationPolicy: form.cancellationPolicy || undefined,
      checkInTime: form.checkInTime || undefined, checkOutTime: form.checkOutTime || undefined,
      hasUnits, unitCount: hasUnits ? Number(unitCount) || 0 : 0, unitCapacity: hasUnits ? Number(unitCapacity) || 1 : 1,
      coverImage: coverImage || undefined, gallery,
      extraServices: extraServices.length > 0 ? extraServices : undefined, activeDays,
    });
    updateMutation.mutate(payload);
  };

  const updateField = (field: string, value: string) => { setForm(prev => ({ ...prev, [field]: value })); if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; }); };
  const handleTitleEnChange = (value: string) => { updateField('titleEn', value); setForm(f => ({ ...f, slug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })); };
  const toggleDay = (day: string) => setActiveDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  const addExtraService = () => {
    const n = extraName.trim();
    if (!n) return;
    setExtraServices(prev => [...prev, { name: n, price: Number(extraPrice) || 0, perPerson: (Number(extraPrice) || 0) > 0 ? extraPerPerson : false }]);
    setExtraName(''); setExtraPrice(''); setExtraPerPerson(false);
  };
  const removeExtraService = (i: number) => setExtraServices(prev => prev.filter((_, idx) => idx !== i));

  // ─── Loading ────────────────────────────────────────────────
  if (activityLoading) {
    return (
      <AdminLayout title="Edit Activity" subtitle="Loading...">
        <div className="space-y-4 max-w-4xl">
          {[1, 2, 3].map(i => (<div key={i} className="h-28 rounded-2xl bg-gray-200 dark:bg-slate-800 animate-pulse" />))}
        </div>
      </AdminLayout>
    );
  }

  if (!activity) {
    return (
      <AdminLayout title="Edit Activity" subtitle="Activity not found">
        <div className="flex flex-col items-center gap-4 py-20">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
          <p className="text-gray-500 dark:text-slate-400">Activity not found or has been deleted.</p>
          <button onClick={() => router.push('/admin/activities')} className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition cursor-pointer">Back to Activities</button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Edit Activity" subtitle={`Editing: ${activity.titleEn}`}>
      <div>

        {/* Step Indicator */}
        <div className="flex items-center mb-10">
          {STEPS.map((step, idx) => (
            <React.Fragment key={step.id}>
              <button type="button" onClick={() => handleStepClick(step.id)} className="flex flex-col items-center gap-1.5 cursor-pointer group">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all group-hover:scale-110 ${
                  currentStep > step.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : currentStep === step.id
                    ? 'bg-white dark:bg-slate-900 border-blue-600 text-blue-600'
                    : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-400 dark:text-slate-500'
                }`}>
                  {currentStep > step.id ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step.id}
                </div>
                <span className={`text-[11px] font-medium whitespace-nowrap ${
                  currentStep === step.id ? 'text-blue-600' : 'text-gray-400 dark:text-slate-500'
                }`}>{step.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${
                  currentStep > step.id ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1 — Basic Info */}
        {currentStep === 1 && (
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Basic Information</h2>

            <div className="grid grid-cols-2 gap-5">
              <FieldGroup label="Title (English)" required error={errors.titleEn}>
                <input value={form.titleEn} onChange={e => handleTitleEnChange(e.target.value)} className={inputCls(!!errors.titleEn)} placeholder="e.g., Premium Desert Safari Experience" />
              </FieldGroup>
              <FieldGroup label="Title (Arabic)" required error={errors.titleAr}>
                <input value={form.titleAr} onChange={e => updateField('titleAr', e.target.value)} className={inputCls(!!errors.titleAr)} placeholder="عنوان النشاط بالعربية" dir="rtl" />
              </FieldGroup>
              <FieldGroup label="Category" required error={errors.categoryId}>
                <CustomSelect options={categories?.map((c: any) => ({ value: c.id, label: c.nameEn })) ?? []} value={form.categoryId} onChange={val => { updateField('categoryId', val); updateField('subCategoryId', ''); }} placeholder="Select category" />
              </FieldGroup>
              <FieldGroup label="Sub Category" error={errors.subCategoryId}>
                <CustomSelect options={subCategories.map((s: any) => ({ value: s.id, label: s.nameEn }))} value={form.subCategoryId} onChange={val => updateField('subCategoryId', val)} placeholder={form.categoryId ? 'Select sub-category (optional)' : 'Select category first'} disabled={!form.categoryId || subCategories.length === 0} />
              </FieldGroup>
              <FieldGroup label="URL Slug" required error={errors.slug} className="col-span-2">
                <input value={form.slug} readOnly tabIndex={-1} className={`${inputCls(!!errors.slug)} bg-gray-100 dark:bg-slate-800/80 cursor-not-allowed text-gray-500 dark:text-slate-400`} placeholder="Auto-generated from title" />
              </FieldGroup>
            </div>
            <div className="grid grid-cols-2 gap-5 mt-5">
              <FieldGroup label="Description (English)" required error={errors.descriptionEn}>
                <textarea value={form.descriptionEn} onChange={e => updateField('descriptionEn', e.target.value)} className={`${inputCls(!!errors.descriptionEn)} min-h-[120px] resize-none`} placeholder="Describe your activity in detail..." />
                <p className={`text-xs mt-1 text-end ${form.descriptionEn.length < 50 ? 'text-amber-500' : 'text-gray-400'}`}>{form.descriptionEn.length}/2000</p>
              </FieldGroup>
              <FieldGroup label="Description (Arabic)" required error={errors.descriptionAr}>
                <textarea value={form.descriptionAr} onChange={e => updateField('descriptionAr', e.target.value)} className={`${inputCls(!!errors.descriptionAr)} min-h-[120px] resize-none`} placeholder="وصف النشاط بالتفصيل..." dir="rtl" />
                <p className={`text-xs mt-1 text-end ${form.descriptionAr.length < 50 ? 'text-amber-500' : 'text-gray-400'}`}>{form.descriptionAr.length}/2000</p>
              </FieldGroup>
            </div>
          </div>
        )}

        {/* Step 2 — Details */}
        {currentStep === 2 && (
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Activity Details</h2>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">Booking Type <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-3">
                {[{ value: 'HOURLY', label: 'Hourly', desc: 'Charge per hour' }, { value: 'DAILY', label: 'Daily', desc: 'Charge per day' }].map(opt => (
                  <button key={opt.value} type="button" onClick={() => updateField('bookingType', opt.value)}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 text-start transition-all cursor-pointer ${form.bookingType === opt.value ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${form.bookingType === opt.value ? 'border-blue-500' : 'border-gray-300'}`}>
                      {form.bookingType === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                    </div>
                    <div><p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p><p className="text-xs text-gray-400">{opt.desc}</p></div>
                  </button>
                ))}
              </div>
            </div>
            {form.bookingType === 'HOURLY' ? (
              <div className="grid grid-cols-2 gap-5 mb-6">
                <FieldGroup label="Duration (Hours)" required error={errors.durationValue}>
                  <input type="number" min="1" max="24" value={form.durationValue} onChange={e => updateField('durationValue', e.target.value)} className={inputCls(!!errors.durationValue)} placeholder="e.g., 3" />
                </FieldGroup>
                <div />
                <FieldGroup label="Start Time" required error={errors.checkInTime}>
                  <TimePicker value={form.checkInTime} onChange={val => updateField('checkInTime', val)} hasError={!!errors.checkInTime} placeholder="Select start time" />
                </FieldGroup>
                <FieldGroup label="End Time" required error={errors.checkOutTime}>
                  <TimePicker value={form.checkOutTime} onChange={val => updateField('checkOutTime', val)} hasError={!!errors.checkOutTime} placeholder="Select end time" />
                </FieldGroup>
              </div>
            ) : (
              <div className="mb-6 space-y-5">
                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/60 dark:border-blue-800/30">
                  <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">Hotel-style booking</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Customers pick check-in/check-out dates. Booked dates are auto-blocked.</p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <FieldGroup label="Check-in Time" required error={errors.checkInTime}>
                    <TimePicker value={form.checkInTime} onChange={val => updateField('checkInTime', val)} hasError={!!errors.checkInTime} placeholder="Select check-in time" />
                  </FieldGroup>
                  <FieldGroup label="Check-out Time" required error={errors.checkOutTime}>
                    <TimePicker value={form.checkOutTime} onChange={val => updateField('checkOutTime', val)} hasError={!!errors.checkOutTime} placeholder="Select check-out time" />
                  </FieldGroup>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Active Days</label>
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">Leave empty to allow any day.</p>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(({ label, value }) => {
                  const active = activeDays.includes(value);
                  return (<button key={value} type="button" onClick={() => toggleDay(value)} className={`px-4 py-2 rounded-full text-sm font-medium border transition-all cursor-pointer ${active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-blue-400/40'}`}>{label}</button>);
                })}
              </div>
            </div>
            {/* Units */}
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Units <span className="text-sm font-normal text-gray-400">(Optional)</span></h3>
                <button type="button" onClick={() => { setHasUnits(v => !v); if (hasUnits) { setUnitCount(''); setUnitCapacity(''); } }} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 cursor-pointer ${hasUnits ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${hasUnits ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Enable for separate bookable units (tents, rooms, cabins).</p>
              {hasUnits && (
                <div className="grid grid-cols-2 gap-5">
                  <FieldGroup label="Number of Units" required error={errors.unitCount}><input type="number" min="1" max="500" value={unitCount} onChange={e => setUnitCount(e.target.value)} className={inputCls(!!errors.unitCount)} placeholder="e.g., 45" /></FieldGroup>
                  <FieldGroup label="Capacity per Unit" required error={errors.unitCapacity}><input type="number" min="1" value={unitCapacity} onChange={e => setUnitCapacity(e.target.value)} className={inputCls(!!errors.unitCapacity)} placeholder="e.g., 4" /></FieldGroup>
                  {Number(unitCount) > 0 && Number(unitCapacity) > 0 && (
                    <div className="col-span-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-200 dark:border-blue-800">
                      <p className="text-sm text-blue-700 dark:text-blue-400 font-medium">Total capacity: <span className="font-bold">{Number(unitCount) * Number(unitCapacity)}</span> guests across <span className="font-bold">{unitCount}</span> units</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3 — Pricing */}
        {currentStep === 3 && (
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Pricing</h2>
            <div className="grid grid-cols-3 gap-8">
              <div className="col-span-2 space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <FieldGroup label={form.bookingType === 'DAILY' ? 'Price per Unit / Night' : form.pricingModel === 'PER_UNIT' ? 'Price per Unit' : 'Price per Person'} required error={errors.pricePerPerson}>
                    <input type="number" min="0" value={form.pricePerPerson} onChange={e => updateField('pricePerPerson', e.target.value)} className={inputCls(!!errors.pricePerPerson)} placeholder="e.g., 150" />
                  </FieldGroup>
                  {!hasUnits && (
                    <FieldGroup label="Max Guests per Booking" error={errors.capacity} hint="Leave empty for unlimited">
                      <input type="number" min="1" value={form.capacity} onChange={e => updateField('capacity', e.target.value)} className={inputCls(!!errors.capacity)} placeholder="e.g., 10" />
                    </FieldGroup>
                  )}
                </div>
                {form.bookingType === 'HOURLY' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">Pricing Model <span className="text-red-500">*</span></label>
                    <div className="space-y-3">
                      {([{ value: 'PER_PERSON', label: 'Per person', desc: 'Price × number of guests' }, { value: 'PER_UNIT', label: 'Per unit (flat)', desc: 'Fixed price — guest count does not affect price' }] as const).map(opt => (
                        <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, pricingModel: opt.value }))}
                          className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-start transition-all cursor-pointer ${form.pricingModel === opt.value ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'}`}>
                          <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${form.pricingModel === opt.value ? 'border-blue-500' : 'border-gray-300'}`}>
                            {form.pricingModel === opt.value && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                          </div>
                          <div><p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p><p className="text-xs text-gray-400">{opt.desc}</p></div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-slate-800/60 rounded-xl p-5 border border-gray-200 dark:border-slate-700">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4"><BookmarkIcon className="h-4 w-4" /> Pricing Preview</p>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between text-gray-600 dark:text-slate-400">
                    <span>{form.bookingType === 'DAILY' ? 'Per unit / night' : form.pricingModel === 'PER_UNIT' ? 'Per unit' : 'Per person'}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{form.pricePerPerson ? `${activity.country?.currencyCode || 'QAR'} ${form.pricePerPerson}` : '\u2014'}</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-slate-700 pt-3 flex justify-between text-gray-600 dark:text-slate-400">
                    <span>Capacity</span>
                    <span className="font-medium text-gray-900 dark:text-white">{hasUnits && Number(unitCount) > 0 ? `${Number(unitCount) * (Number(unitCapacity) || 1)} (${unitCount} units)` : form.capacity || '\u2014'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 — Location */}
        {currentStep === 4 && (
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Location</h2>
            <div className="grid grid-cols-2 gap-5 mb-5">
              <FieldGroup label="Location Name" required error={errors.locationAddress}>
                <input value={form.locationAddress} onChange={e => updateField('locationAddress', e.target.value)} className={inputCls(!!errors.locationAddress)} placeholder="e.g., The Pearl, Doha" />
              </FieldGroup>
              <FieldGroup label="City" required error={errors.cityId}>
                <CustomSelect options={cities?.map((c: any) => ({ value: c.id, label: c.nameEn })) ?? []} value={form.cityId} onChange={val => updateField('cityId', val)} placeholder="Select city" />
              </FieldGroup>
            </div>
            <FieldGroup label="Map Location (Optional)" error={errors.locationLat}>
              <LocationPicker value={{ address: form.locationAddress, lat: Number(form.locationLat) || 0, lng: Number(form.locationLng) || 0 }}
                onChange={({ address, lat, lng }) => { updateField('locationAddress', address); updateField('locationLat', lat ? String(lat) : ''); updateField('locationLng', lng ? String(lng) : ''); }}
                placeholder="Search or click on map to pin location" />
            </FieldGroup>
          </div>
        )}

        {/* Step 5 — Media */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Cover Image</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Main image customers will see on the activity card.</p>
              <CoverImageUploader value={coverImage} onChange={setCoverImage} error={errors.coverImage} />
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Gallery Images</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Additional photos. Minimum 2, maximum 10.</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">{gallery.length} / 10 uploaded</p>
              <ImageUploader value={gallery} onChange={setGallery} error={errors.gallery} />
            </div>
          </div>
        )}

        {/* Step 6 — Policies */}
        {currentStep === 6 && (
          <div className="space-y-5">
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Inclusions & Add-ons</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Price <strong>0</strong> = free inclusion. Priced items = optional add-ons.</p>
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Name</label>
                  <input type="text" value={extraName} onChange={e => setExtraName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraService(); } }} className={inputCls(false)} placeholder="e.g., Water, Lunch" maxLength={200} />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Price (0 = free)</label>
                  <input type="number" min="0" step="0.01" value={extraPrice} onChange={e => setExtraPrice(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraService(); } }} className={inputCls(false)} placeholder="0" />
                </div>
                {(Number(extraPrice) || 0) > 0 && (
                  <div className="flex items-center gap-3 pb-0.5">
                    <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="extraPricing" checked={!extraPerPerson} onChange={() => setExtraPerPerson(false)} className="w-3.5 h-3.5" /><span className="text-xs text-gray-600 dark:text-slate-400">Per booking</span></label>
                    <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="extraPricing" checked={extraPerPerson} onChange={() => setExtraPerPerson(true)} className="w-3.5 h-3.5" /><span className="text-xs text-gray-600 dark:text-slate-400">Per person</span></label>
                  </div>
                )}
                <button type="button" onClick={addExtraService} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer">Add</button>
              </div>
              {extraServices.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No items added yet</p>
              ) : (
                <div className="space-y-2">
                  {extraServices.map((svc, i) => (
                    <div key={i} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${svc.price === 0 ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400' : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30 text-blue-700 dark:text-blue-400'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${svc.price === 0 ? 'bg-emerald-500/20 text-emerald-600' : 'bg-blue-500/20 text-blue-600'}`}>{svc.price === 0 ? 'Included' : svc.perPerson ? 'Per person' : 'Per booking'}</span>
                        <span className="font-medium">{svc.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {svc.price > 0 && <span className="font-semibold">+{svc.price} {activity.country?.currencyCode || 'QAR'}{svc.perPerson ? ' /person' : ''}</span>}
                        <button type="button" onClick={() => removeExtraService(i)} className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"><X className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Cancellation Policy <span className="text-red-500">*</span></h2>
              {errors.cancellationPolicy && <p className="text-xs text-red-500 mb-3">{errors.cancellationPolicy}</p>}
              <div className="space-y-3 mt-4">
                {[
                  { value: 'FREE_CANCELLATION', label: 'Free Cancellation', desc: 'Full refund before the deadline' },
                  { value: 'PARTIAL_REFUND', label: 'Partial Refund', desc: 'Partial refund before the deadline' },
                  { value: 'NON_REFUNDABLE', label: 'Non-Refundable', desc: 'No refund available' },
                ].map(opt => (
                  <button key={opt.value} type="button" onClick={() => updateField('cancellationPolicy', opt.value)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-start transition-all cursor-pointer ${form.cancellationPolicy === opt.value ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${form.cancellationPolicy === opt.value ? 'border-blue-500' : 'border-gray-300'}`}>
                      {form.cancellationPolicy === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                    </div>
                    <div><p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p><p className="text-xs text-gray-400">{opt.desc}</p></div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          {currentStep > 1 ? (
            <button type="button" onClick={handleBack} className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-gray-600 dark:text-slate-400 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">&larr; Back</button>
          ) : <div />}
          {currentStep < STEPS.length ? (
            <button type="button" onClick={handleNext} className="flex items-center gap-2 px-8 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer">Next &rarr;</button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={updateMutation.isPending} className="flex items-center gap-2 px-8 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm disabled:opacity-50 cursor-pointer">
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </button>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────── */

const inputCls = (hasError: boolean) =>
  `w-full px-4 py-3 bg-white dark:bg-slate-800 border rounded-xl text-sm focus:outline-none focus:ring-2 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-colors ${
    hasError ? 'border-red-400 focus:ring-red-400/20' : 'border-gray-200 dark:border-slate-700 focus:ring-blue-500/20 focus:border-blue-500/50'
  }`;

function FieldGroup({ label, required, error, hint, className = '', children }: { label: string; required?: boolean; error?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
